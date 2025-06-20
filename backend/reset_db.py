from pymongo import MongoClient
import gridfs
import os
import shutil

# MongoDB connection setup
mongo_uri = 'mongodb://localhost:27017/'
db_name = 'face_recognition_db'

def reset_database():
    print("Connecting to MongoDB...")
    client = MongoClient(mongo_uri)
    
    # Drop existing database
    print(f"Dropping database: {db_name}")
    client.drop_database(db_name)
    
    # Create new database
    db = client[db_name]
    
    # Create collections
    db.create_collection('persons')
    db.create_collection('encodings')
    db.create_collection('history')
    
    # Initialize GridFS
    fs = gridfs.GridFS(db)
    
    # Create initial history document
    db.history.insert_one({
        'type': 'history',
        'image_history': [],
        'recognized_persons': [],
        'unrecognized_persons': []
    })
    
    print(f"Database {db_name} successfully reset with collections:")
    for collection in db.list_collection_names():
        print(f"- {collection}")
    
    print("\nDone! The application should now work correctly.")

if __name__ == "__main__":
    reset_database() 