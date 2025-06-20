import uuid
import face_recognition
import numpy as np
import os
from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image
import database as db
from datetime import datetime

# Initialize Flask application
app = Flask(__name__)
CORS(app)  # Enable Cross-Origin Resource Sharing

# API endpoint to get all persons
@app.route('/api/persons', methods=['GET'])
def api_get_persons():
    return jsonify(db.get_all_persons())

# API endpoint to get history data
@app.route('/api/history', methods=['GET'])
def api_get_history():
    return jsonify(db.get_history())

# API endpoint to save history data
@app.route('/api/history', methods=['POST'])
def api_save_history():
    try:
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400
            
        success = db.save_history(data)
        
        if success:
            return jsonify({"message": "History saved successfully"})
        else:
            return jsonify({"error": "Failed to save history"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# API endpoint to upload and process an image for face recognition
@app.route('/api/upload', methods=['POST'])
def upload_image():
    
    # Check if image is provided
    if 'image' not in request.files:
        return jsonify({"error": "No image provided"}), 400

    try:
        file = request.files['image']
        # Read image file
        img = face_recognition.load_image_file(file)

        # Debug: Save original image with timestamp for debugging
        debug_timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        orig_filename = f"original_{debug_timestamp}.jpg"
        db.save_debug_image(img, [], orig_filename)
        
        face_locations = face_recognition.face_locations(
            img, 
            model='hog', 
            number_of_times_to_upsample=0
        )
        
        # Debug: Save image with all detected faces before filtering
        all_faces_filename = f"all_faces_{debug_timestamp}.jpg"
        db.save_debug_image(img, face_locations, all_faces_filename)
        
        filtered_face_locations = []
        img_height, img_width = img.shape[:2]
        # Increase minimum face size to 8% of image dimension to further reduce false positives
        min_face_size = min(img_height, img_width) * 0.08
        
        print(f"Image dimensions: {img_width}x{img_height}, Min face size: {min_face_size}")
        
        for face_loc in face_locations:
            top, right, bottom, left = face_loc
            face_height = bottom - top
            face_width = right - left
            
            print(f"Detected face: {face_width}x{face_height}, Aspect ratio: {face_width/face_height:.2f}")
            
            # Skip if face is too small (likely false positive)
            if face_height < min_face_size or face_width < min_face_size:
                print(f"Skipping face - too small: {face_width}x{face_height}")
                continue
                
            # Skip if aspect ratio is too extreme (likely false positive)
            aspect_ratio = face_width / face_height
            if aspect_ratio < 0.6 or aspect_ratio > 1.7:
                print(f"Skipping face - aspect ratio out of range: {aspect_ratio:.2f}")
                continue
                
            filtered_face_locations.append(face_loc)
        
        # Debug: Save image with only filtered faces
        filtered_filename = f"filtered_faces_{debug_timestamp}.jpg"
        db.save_debug_image(img, filtered_face_locations, filtered_filename)
        
        print(f"Original faces: {len(face_locations)}, Filtered faces: {len(filtered_face_locations)}")
        
        if not filtered_face_locations:
            return jsonify({"error": "No valid faces detected in the image"}), 400
        
        # Get face encodings for the filtered faces
        face_encodings = face_recognition.face_encodings(img, filtered_face_locations)
        
        results = []

        # Process each detected face
        for i, (face_encoding, face_location) in enumerate(zip(face_encodings, filtered_face_locations)):
            # Find matches for this face
            matches = db.find_person_matches(face_encoding)
            
            # Sort matches by confidence (highest first)
            matches = sorted(matches, key=lambda x: x["confidence"], reverse=True)
            
            # Crop the face from the image
            top, right, bottom, left = face_location
            face_image = img[top:bottom, left:right]
            
            # Prepare image for storage
            img_bytes, face_image_base64 = db.prepare_image_for_storage(face_image)
            
            # Generate a unique ID for this face
            face_id = str(uuid.uuid4())
            
            # Process based on whether we have a good match
            if matches and matches[0]["confidence"] > 60:  # Confidence threshold
                # We have a match with good confidence
                best_match = matches[0]
                person_name = best_match["name"]
                confidence = best_match["confidence"]
                
                # Check if this exact image is already in the database
                is_duplicate = db.is_duplicate_image(person_name, img_bytes)
                
                if not is_duplicate:
                    # Save face image to GridFS only if it's not a duplicate
                    file_id = db.save_face_image(img_bytes, face_id)
                    
                    # Store face info in MongoDB
                    db.add_face_to_person(person_name, face_id, file_id, face_encoding.tolist())
                
                # Return the face in results (no indication of duplicate)
                results.append({
                    "id": face_id,
                    "name": person_name,
                    "confidence": confidence,
                    "face_image": face_image_base64,
                    "face_position": face_location
                })
            else:
                # No good match found - save as unrecognized face
                file_id = db.save_face_image(img_bytes, face_id)
                
                # Store in MongoDB as unrecognized
                db.save_unrecognized_face(face_id, file_id, face_encoding.tolist())
                
                results.append({
                    "id": face_id,
                    "name": "Person not found",
                    "confidence": 0,
                    "face_image": face_image_base64,
                    "face_position": face_location
                })
        
        return jsonify({
            "message": f"Processed {len(results)} faces",
            "results": results
        })
    except Exception as e:
        return jsonify({"error": f"Error processing image: {str(e)}"}), 500

# API endpoint to create a new person from an unrecognized face
@app.route('/api/person/create', methods=['POST'])
def create_person():
    
    try:
        data = request.json
        
        if not data or 'faceId' not in data or 'name' not in data:
            return jsonify({"error": "Missing required fields"}), 400
        
        face_id = data['faceId']
        person_name = data['name']
        
        # Find the unrecognized face document
        unrecognized_face = db.get_unrecognized_face(face_id)
        
        if not unrecognized_face:
            return jsonify({"error": "Face ID not found in unrecognized faces"}), 404
        
        # Get the file from GridFS to check for duplicates
        file_id = unrecognized_face['file_id']
        try:
            img_bytes = db.fs.get(file_id).read()
            # Check if this image is already in the database for this person
            is_duplicate = db.is_duplicate_image(person_name, img_bytes)
            
            if is_duplicate:
                # Still mark as recognized
                db.mark_face_as_recognized(face_id, person_name)
                
                return jsonify({
                    "message": f"Added face to person: {person_name}",
                    "person": person_name
                })
        except Exception as e:
            # If we can't read the file or check for duplicates, just proceed with adding
            print(f"Error checking for duplicate: {e}")
        
        # Get encoding
        face_encoding = unrecognized_face['encoding']
        
        # Add face to person (creates the person if it doesn't exist)
        success = db.add_face_to_person(person_name, face_id, file_id, face_encoding)
        
        if not success:
            return jsonify({"error": "Failed to add face to person"}), 500
        
        # Mark the face as recognized
        db.mark_face_as_recognized(face_id, person_name)
        
        return jsonify({
            "message": f"Added face to person: {person_name}",
            "person": person_name
        })
    except Exception as e:
        return jsonify({"error": f"Error creating person: {str(e)}"}), 500

# API endpoint to add an unrecognized face to an existing person
@app.route('/api/person/add', methods=['POST'])
def add_to_person():
   
    try:
        data = request.json
        
        if not data or 'faceId' not in data or 'personName' not in data:
            return jsonify({"error": "Missing required fields"}), 400
        
        face_id = data['faceId']
        person_name = data['personName']
        
        # Find the unrecognized face document
        unrecognized_face = db.get_unrecognized_face(face_id)
        
        if not unrecognized_face:
            return jsonify({"error": "Face ID not found in unrecognized faces"}), 404
        
        # Check if person exists
        person = db.persons_collection.find_one({'name': person_name})
        
        if not person:
            return jsonify({"error": "Person not found"}), 404
        
        # Get the file from GridFS to check for duplicates
        file_id = unrecognized_face['file_id']
        try:
            img_bytes = db.fs.get(file_id).read()
            # Check if this image is already in the database for this person
            is_duplicate = db.is_duplicate_image(person_name, img_bytes)
            
            if is_duplicate:
                # Still mark as recognized
                db.mark_face_as_recognized(face_id, person_name)
                
                return jsonify({
                    "message": f"Added face to person: {person_name}",
                    "person": person_name
                })
        except Exception as e:
            # If we can't read the file or check for duplicates, just proceed with adding
            print(f"Error checking for duplicate: {e}")
        
        # Get encoding
        face_encoding = unrecognized_face['encoding']
        
        # Add face to existing person
        success = db.add_face_to_person(person_name, face_id, file_id, face_encoding)
        
        if not success:
            return jsonify({"error": "Failed to add face to person"}), 500
        
        # Mark the face as recognized
        db.mark_face_as_recognized(face_id, person_name)
        
        return jsonify({
            "message": f"Added face to person: {person_name}",
            "person": person_name
        })
    except Exception as e:
        return jsonify({"error": f"Error adding face to person: {str(e)}"}), 500

# API endpoint to delete a person and all their face images
@app.route('/api/person/delete', methods=['POST'])
def delete_person():
    
    try:
        data = request.json
        
        if not data or 'personName' not in data:
            return jsonify({"error": "Missing required fields"}), 400
        
        person_name = data['personName']
        success = db.delete_person(person_name)
        
        if success:
            return jsonify({
                "message": f"Successfully deleted person: {person_name}",
                "person": person_name
            })
        else:
            return jsonify({"error": f"Person not found: {person_name}"}), 404
    except Exception as e:
        return jsonify({"error": f"Error deleting person: {str(e)}"}), 500

# API endpoint to delete an unrecognized face
@app.route('/api/face/delete', methods=['POST'])
def delete_face():
    
    try:
        data = request.json
        
        if not data or 'faceId' not in data:
            return jsonify({"error": "Missing required fields"}), 400
        
        face_id = data['faceId']
        success = db.delete_unrecognized_face(face_id)
        
        if success:
            return jsonify({
                "message": f"Successfully deleted face: {face_id}",
                "faceId": face_id
            })
        else:
            return jsonify({"error": f"Face not found: {face_id}"}), 404
    except Exception as e:
        return jsonify({"error": f"Error deleting face: {str(e)}"}), 500

# API endpoint to delete all persons and their face images
@app.route('/api/persons/delete-all', methods=['POST'])
def delete_all_persons():
   
    try:
        count = db.delete_all_persons()
        return jsonify({
            "message": f"Successfully deleted {count} persons",
            "count": count
        })
    except Exception as e:
        return jsonify({"error": f"Error deleting persons: {str(e)}"}), 500

# API endpoint to delete all unrecognized faces
@app.route('/api/faces/delete-all', methods=['POST'])
def delete_all_faces():
    
    try:
        count = db.delete_all_unrecognized_faces()
        return jsonify({
            "message": f"Successfully deleted {count} unrecognized faces",
            "count": count
        })
    except Exception as e:
        return jsonify({"error": f"Error deleting faces: {str(e)}"}), 500

# API endpoint to delete all history data
@app.route('/api/history/delete-all', methods=['POST'])
def delete_all_history():
    
    try:
        success = db.delete_all_history()
        return jsonify({
            "message": "Successfully deleted all history data",
            "success": success
        })
    except Exception as e:
        return jsonify({"error": f"Error deleting history: {str(e)}"}), 500

# API endpoint to delete a specific face image from a person
@app.route('/api/face/delete-from-person', methods=['POST'])
def delete_face_from_person():
    
    try:
        data = request.json
        
        if not data or 'personName' not in data or 'faceId' not in data:
            return jsonify({"error": "Missing required fields"}), 400
        
        person_name = data['personName']
        face_id = data['faceId']
        
        # Find the person document
        person = db.persons_collection.find_one({'name': person_name})
        
        if not person:
            return jsonify({"error": f"Person not found: {person_name}"}), 404
        
        # Check if the face ID exists in the person's face_ids
        if 'face_ids' not in person or face_id not in person['face_ids']:
            return jsonify({"error": f"Face ID not found for this person: {face_id}"}), 404
        
        # Get the index of the face ID
        face_index = person['face_ids'].index(face_id)
        
        # Get the file ID for this face
        file_id = None
        if 'file_ids' in person and len(person['file_ids']) > face_index:
            file_id = person['file_ids'][face_index]
        
        # Remove the face ID, file ID, and encoding from the person document
        update_result = db.persons_collection.update_one(
            {'name': person_name},
            {
                '$pull': {
                    'face_ids': face_id
                }
            }
        )
        
        # Also remove the file ID and encoding separately since they might not be in the same order
        if file_id:
            db.persons_collection.update_one(
                {'name': person_name},
                {
                    '$pull': {
                        'file_ids': file_id
                    }
                }
            )
            
            # Delete the file from GridFS
            try:
                db.fs.delete(file_id)
            except Exception as e:
                print(f"Error deleting file {file_id}: {e}")
        
        # Remove the encoding if it exists
        if 'encodings' in person and len(person['encodings']) > face_index:
            db.persons_collection.update_one(
                {'name': person_name},
                {
                    '$pull': {
                        'encodings': person['encodings'][face_index]
                    }
                }
            )
        
        if update_result.modified_count > 0:
            return jsonify({
                "message": f"Successfully deleted face from person: {person_name}",
                "person": person_name,
                "faceId": face_id
            })
        else:
            return jsonify({"error": "Failed to delete face"}), 500
    except Exception as e:
        return jsonify({"error": f"Error deleting face: {str(e)}"}), 500

# Run the application if this script is executed directly
if __name__ == '__main__':

    debug_mode = True
    port = 5000
    app.run(debug=debug_mode, port=port)
