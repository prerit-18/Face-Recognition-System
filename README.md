# Smart Face Recognition System

A modern face recognition system that automatically recognizes faces in images, organizes them by person, and handles unrecognized faces with a user-friendly interface.

## Features

- Detect and analyze faces in uploaded images
- Automatically recognize known persons
- Create new person profiles for unrecognized faces
- Add unrecognized faces to existing persons
- View history of uploads and recognized persons
- Modern, responsive UI with dark theme

## Setup Instructions

### Backend (Python/Flask)

1. Create a virtual environment:
   ```
   python -m venv venv
   ```

2. Activate the virtual environment:
   - Windows: `venv\Scripts\activate`
   - Mac/Linux: `source venv/bin/activate`

3. Install dependencies:
   ```
   cd backend
   pip install -r requirements.txt
   ```

4. Run the Flask server:
   ```
   python app.py
   ```
   
   The backend server will start on http://localhost:5000

> **Note**: If you encounter issues installing `face_recognition`, you may need to install `dlib` separately. Follow instructions on the [dlib GitHub page](https://github.com/davisking/dlib).

### Frontend (React)

1. Install dependencies:
   ```
   cd frontend
   npm install
   ```

2. Start the development server:
   ```
   npm start
   ```
   
   The frontend will be available at http://localhost:3000

## Usage

1. Upload an image containing faces using the "Choose Image" button.

2. The system will automatically detect faces and attempt to recognize them.

3. Recognized faces will be added to existing persons in the right sidebar.

4. Unrecognized faces will be shown in the "Unrecognized" tab.

5. For unrecognized faces:
   - Click the "+" button to add to an existing person or create a new person
   - When creating a new person, the default name is taken from the image filename

6. All recognized persons are organized in folders in the right sidebar.

7. Click on any face thumbnail to view it in a larger modal.

## Data Storage

- All face data is stored locally in the `backend/data` directory
- Recognized persons are stored in `backend/data/persons/{person_name}`
- Unrecognized faces are stored in `backend/data/unrecognized`
- Face encodings are saved in `backend/data/encodings.json`
- The system does not use any external database or cloud storage 