import json
import uuid
import base64
import numpy as np
import gridfs
import face_recognition
import os
import cv2
from pymongo import MongoClient
from bson.objectid import ObjectId
from datetime import datetime
from PIL import Image
from io import BytesIO
import hashlib

# MongoDB connection setup - Creates the connection to MongoDB database
# Use direct connection string without dotenv
mongo_uri = 'mongodb://localhost:27017/'
db_name = 'face_recognition_db'

client = MongoClient(mongo_uri)
db = client[db_name]
fs = gridfs.GridFS(db)

# Collections used in the application
persons_collection = db['persons']
encodings_collection = db['encodings']
history_collection = db['history']

def get_all_persons():
    
    persons = list(persons_collection.find({}, {'name': 1}))
    unrecognized = list(encodings_collection.find({'recognized': False}, {'_id': 1}))
    
    return {
        "persons": [person['name'] for person in persons],
        "unrecognized": [str(face['_id']) for face in unrecognized]
    }

def get_history():
    
    history = history_collection.find_one({'type': 'history'}) or {
        'image_history': [],
        'recognized_persons': [],
        'unrecognized_persons': []
    }
    
    # Remove MongoDB _id from the response
    if '_id' in history:
        del history['_id']
        
    return history

def save_history(data):
    
    if not data:
        return False
        
    history = {
        'type': 'history',
        'image_history': data.get('image_history', []),
        'recognized_persons': data.get('recognized_persons', []),
        'unrecognized_persons': data.get('unrecognized_persons', [])
    }
    
    # Update or insert history document
    result = history_collection.update_one(
        {'type': 'history'}, 
        {'$set': history}, 
        upsert=True
    )
    
    return bool(result.acknowledged)

def save_face_image(img_bytes, face_id):
    
    return fs.put(img_bytes, filename=f"{face_id}.jpg", content_type="image/jpeg")

def find_person_matches(face_encoding):
    
    matches = []
    
    # Check if the face matches any known person
    for person in persons_collection.find():
        person_name = person['name']
        person_encodings = person.get('encodings', [])
        
        for stored_encoding in person_encodings:
            # Convert stored encoding from list to numpy array
            stored_encoding_array = np.array(stored_encoding)
            
            # Calculate distance (lower means more similar)
            distance = face_recognition.face_distance([stored_encoding_array], face_encoding)[0]
            
            # If distance is below threshold, consider it a match
            if distance < 0.6:  # Adjust threshold as needed
                confidence = int((1 - distance) * 100)
                matches.append({"name": person_name, "confidence": confidence})
    
    # Sort matches by confidence (highest first)
    return sorted(matches, key=lambda x: x["confidence"], reverse=True)

def image_hash(img_bytes):
    
    return hashlib.md5(img_bytes).hexdigest()

def is_duplicate_image(person_name, img_bytes):
    
    # Generate hash of the new image
    new_hash = image_hash(img_bytes)
    
    # Get the person from the database
    person = persons_collection.find_one({'name': person_name})
    
    if not person or 'file_ids' not in person:
        return False
    
    # Check against all existing images
    for file_id in person['file_ids']:
        try:
            # Get the image from GridFS
            existing_img_bytes = fs.get(file_id).read()
            existing_hash = image_hash(existing_img_bytes)
            
            # Compare hashes
            if existing_hash == new_hash:
                return True
        except Exception as e:
            print(f"Error comparing image: {e}")
    
    return False

def add_face_to_person(person_name, face_id, file_id, face_encoding):
    
    # Check if person exists
    person = persons_collection.find_one({'name': person_name})
    
    if person:
        # Add face to existing person
        result = persons_collection.update_one(
            {'name': person_name},
            {'$push': {
                'face_ids': face_id,
                'file_ids': file_id,
                'encodings': face_encoding
            }}
        )
    else:
        # Create new person
        result = persons_collection.insert_one({
            'name': person_name,
            'face_ids': [face_id],
            'file_ids': [file_id],
            'encodings': [face_encoding],
            'created_at': datetime.now()
        })
    
    return bool(result.acknowledged)

def save_unrecognized_face(face_id, file_id, face_encoding):
    
    result = encodings_collection.insert_one({
        '_id': ObjectId(),
        'face_id': face_id,
        'file_id': file_id,
        'encoding': face_encoding,
        'recognized': False,
        'timestamp': datetime.now()
    })
    
    return bool(result.acknowledged)

def get_unrecognized_face(face_id):
    
    return encodings_collection.find_one({'face_id': face_id, 'recognized': False})

def mark_face_as_recognized(face_id, person_name):
    
    result = encodings_collection.update_one(
        {'face_id': face_id},
        {'$set': {'recognized': True, 'person_name': person_name}}
    )
    
    return bool(result.acknowledged)

def prepare_image_for_storage(face_image):
    
    pil_image = Image.fromarray(face_image)
    
    # Convert to bytes for MongoDB
    buffered = BytesIO()
    pil_image.save(buffered, format="JPEG")
    img_bytes = buffered.getvalue()
    
    # Prepare base64 for response
    img_str = base64.b64encode(img_bytes).decode("utf-8")
    face_image_base64 = f"data:image/jpeg;base64,{img_str}"
    
    return img_bytes, face_image_base64

def delete_person(person_name):
    
    # Get the person's document to retrieve file IDs
    person = persons_collection.find_one({'name': person_name})
    
    if not person:
        return False
    
    # Delete all files from GridFS
    if 'file_ids' in person:
        for file_id in person['file_ids']:
            try:
                fs.delete(file_id)
            except Exception as e:
                print(f"Error deleting file {file_id}: {e}")
    
    # Delete the person document
    result = persons_collection.delete_one({'name': person_name})
    
    # Update encodings to mark as unrecognized for this person
    if 'face_ids' in person:
        for face_id in person['face_ids']:
            try:
                encodings_collection.update_one(
                    {'face_id': face_id, 'person_name': person_name},
                    {'$set': {'recognized': False, 'person_name': None}}
                )
            except Exception as e:
                print(f"Error updating encoding for face {face_id}: {e}")
    
    return bool(result.deleted_count > 0)

def delete_unrecognized_face(face_id):
    
    # Get the face document to retrieve file ID
    face = encodings_collection.find_one({'face_id': face_id, 'recognized': False})
    
    if not face:
        return False
    
    # Delete the file from GridFS
    if 'file_id' in face:
        try:
            fs.delete(face['file_id'])
        except Exception as e:
            print(f"Error deleting file for face {face_id}: {e}")
    
    # Delete the face document
    result = encodings_collection.delete_one({'face_id': face_id, 'recognized': False})
    
    return bool(result.deleted_count > 0)

def delete_all_persons():
    
    # Get all persons to retrieve file IDs
    persons = list(persons_collection.find({}, {'file_ids': 1}))
    
    # Delete all files from GridFS
    for person in persons:
        if 'file_ids' in person:
            for file_id in person['file_ids']:
                try:
                    fs.delete(file_id)
                except Exception as e:
                    print(f"Error deleting file {file_id}: {e}")
    
    # Delete all person documents
    result = persons_collection.delete_many({})
    
    # Update all encodings to mark as unrecognized
    encodings_collection.update_many(
        {'recognized': True},
        {'$set': {'recognized': False, 'person_name': None}}
    )
    
    return result.deleted_count

def delete_all_unrecognized_faces():
    
    # Get all unrecognized faces to retrieve file IDs
    faces = list(encodings_collection.find({'recognized': False}, {'file_id': 1}))
    
    # Delete all files from GridFS
    for face in faces:
        if 'file_id' in face:
            try:
                fs.delete(face['file_id'])
            except Exception as e:
                print(f"Error deleting file for face: {e}")
    
    # Delete all unrecognized face documents
    result = encodings_collection.delete_many({'recognized': False})
    
    return result.deleted_count

def delete_all_history():
    
    result = history_collection.delete_one({'type': 'history'})
    
    # Create an empty history document
    history_collection.insert_one({
        'type': 'history',
        'image_history': [],
        'recognized_persons': [],
        'unrecognized_persons': []
    })
    
    return bool(result.deleted_count > 0)

def save_debug_image(img, face_locations, filename="debug_faces.jpg"):
    
    # Make a copy to avoid modifying the original
    debug_img = np.copy(img)
    
    # Convert from RGB to BGR (for OpenCV)
    if debug_img.shape[2] == 3:
        debug_img = cv2.cvtColor(debug_img, cv2.COLOR_RGB2BGR)
    
    # Draw rectangles around each face
    for face_loc in face_locations:
        top, right, bottom, left = face_loc
        # Draw rectangle (green)
        cv2.rectangle(debug_img, (left, top), (right, bottom), (0, 255, 0), 2)
    
    # Create debug directory if it doesn't exist
    debug_dir = os.path.join(os.path.dirname(__file__), "debug")
    if not os.path.exists(debug_dir):
        os.makedirs(debug_dir)
    
    # Save the image
    output_path = os.path.join(debug_dir, filename)
    cv2.imwrite(output_path, debug_img)
    
    return output_path 