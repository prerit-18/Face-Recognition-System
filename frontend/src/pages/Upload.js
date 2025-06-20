import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios';
import Swal from 'sweetalert2';
import '../styles/Upload.css';

const API_URL = 'http://localhost:5000/api';

// Helper function to deduplicate unrecognized faces
const deduplicateUnrecognizedFaces = (faces) => {
  const uniqueImages = new Map();
  
  return faces.filter(face => {
    if (!uniqueImages.has(face.image)) {
      uniqueImages.set(face.image, true);
      return true;
    }
    return false;
  });
};

const Upload = () => {
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  
  // State for persons and image history
  const [imageHistory, setImageHistory] = useState([]);
  const [recognizedPersons, setRecognizedPersons] = useState([]);
  const [unrecognizedPersons, setUnrecognizedPersons] = useState([]);
  const [allPersons, setAllPersons] = useState([]);
  
  // Modal states
  const [modalImage, setModalImage] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [personModal, setPersonModal] = useState(false);
  const [selectedFace, setSelectedFace] = useState(null);
  const [newPersonName, setNewPersonName] = useState('');
  const [selectedPersonName, setSelectedPersonName] = useState('');
  
  // Tab state for right sidebar
  const [activeTab, setActiveTab] = useState('recognized');
  
  // State to track if data is being loaded initially
  const [initialLoad, setInitialLoad] = useState(true);
  
  // Fetch persons callback function to avoid recreating on each render
  const fetchPersons = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/persons`);
      setAllPersons(response.data.persons);
    } catch (error) {
      console.error('Error fetching persons:', error);
    }
  }, []);
  
  // Fetch history data from backend
  const fetchHistoryFromBackend = useCallback(async () => {
    try {
      const response = await axios.get(`${API_URL}/history`);
      if (response.data) {
        // Update state with data from backend
        if (response.data.image_history?.length > 0) {
          setImageHistory(response.data.image_history);
        }
        
        if (response.data.recognized_persons?.length > 0) {
          setRecognizedPersons(response.data.recognized_persons);
        }
        
        if (response.data.unrecognized_persons?.length > 0) {
          // Deduplicate unrecognized persons before setting state
          const deduplicated = deduplicateUnrecognizedFaces(response.data.unrecognized_persons);
          setUnrecognizedPersons(deduplicated);
        }
      }
    } catch (error) {
      console.error('Error fetching history from backend:', error);
    }
  }, []);
  
  // Save history data to backend
  const saveHistoryToBackend = useCallback(async () => {
    try {
      await axios.post(`${API_URL}/history`, {
        image_history: imageHistory,
        recognized_persons: recognizedPersons,
        unrecognized_persons: unrecognizedPersons
      });
    } catch (error) {
      console.error('Error saving history to backend:', error);
    }
  }, [imageHistory, recognizedPersons, unrecognizedPersons]);

  // Load data from localStorage on mount
  useEffect(() => {
    // Load data from localStorage and backend
    const loadData = async () => {
      try {
        // First try to load from localStorage for quick rendering
        const loadFromLocalStorage = () => {
          try {
            const savedHistory = localStorage.getItem('imageHistory');
            const savedPersons = localStorage.getItem('recognizedPersons');
            const savedUnrecognized = localStorage.getItem('unrecognizedPersons');
            
            if (savedHistory) {
              setImageHistory(JSON.parse(savedHistory));
            }
            
            if (savedPersons) {
              setRecognizedPersons(JSON.parse(savedPersons));
            }
            
            if (savedUnrecognized) {
              setUnrecognizedPersons(JSON.parse(savedUnrecognized));
            }
          } catch (error) {
            console.error('Error loading data from localStorage:', error);
          }
        };
        
        // Load from localStorage first for quick display
        loadFromLocalStorage();
        
        // Then fetch from backend for most up-to-date data
        await fetchHistoryFromBackend();
        
        // Fetch available persons from backend
        await fetchPersons();
        
        // Mark initial load as complete
        setInitialLoad(false);
      } catch (error) {
        console.error('Error loading initial data:', error);
        setInitialLoad(false);
      }
    };
    
    loadData();
    
    // Setup event listener for when the app comes back into focus
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchHistoryFromBackend();
        fetchPersons();
      }
    };
    
    // Setup window beforeunload event to save data before closing
    const handleBeforeUnload = () => {
      localStorage.setItem('imageHistory', JSON.stringify(imageHistory));
      localStorage.setItem('recognizedPersons', JSON.stringify(recognizedPersons));
      localStorage.setItem('unrecognizedPersons', JSON.stringify(unrecognizedPersons));
      
      // Can't use async in beforeunload, so we do sync localStorage save
      // The backend save happens in useEffect below
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    
    // Clean up event listener on unmount
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [fetchHistoryFromBackend, fetchPersons]);

  // Save to localStorage and backend when data changes
  useEffect(() => {
    // Don't save during initial load
    if (initialLoad) return;
    
    try {
      localStorage.setItem('imageHistory', JSON.stringify(imageHistory));
      saveHistoryToBackend();
    } catch (error) {
      console.error('Error saving image history:', error);
    }
  }, [imageHistory, initialLoad, saveHistoryToBackend]);
  
  useEffect(() => {
    // Don't save during initial load
    if (initialLoad) return;
    
    try {
      localStorage.setItem('recognizedPersons', JSON.stringify(recognizedPersons));
      saveHistoryToBackend();
    } catch (error) {
      console.error('Error saving recognized persons:', error);
    }
  }, [recognizedPersons, initialLoad, saveHistoryToBackend]);
  
  useEffect(() => {
    // Don't save during initial load
    if (initialLoad) return;
    
    try {
      localStorage.setItem('unrecognizedPersons', JSON.stringify(unrecognizedPersons));
      saveHistoryToBackend();
    } catch (error) {
      console.error('Error saving unrecognized persons:', error);
    }
  }, [unrecognizedPersons, initialLoad, saveHistoryToBackend]);

  const handleChange = (e) => {
    const file = e.target.files[0];
    setImage(file);
    setError('');
    setMessage('');
    setResults([]);
    
    // Create preview
    if (file) {
      // Check if the file is an image
      if (!file.type.match('image.*')) {
        setError('Please select an image file (JPG, JPEG, or PNG)');
        setImage(null);
        setPreview(null);
        return;
      }
      
      const reader = new FileReader();
      reader.onloadend = () => {
        setPreview(reader.result);
      };
      reader.readAsDataURL(file);
      
      // Use filename as default person name (without extension)
      const fileName = file.name.replace(/\.[^/.]+$/, "");
      setNewPersonName(fileName);
    } else {
      setPreview(null);
    }
  };

  const handleUpload = async () => {
    if (!image) return;
    
    setLoading(true);
    setError('');
    setMessage('');
    setResults([]);
    
    const formData = new FormData();
    formData.append('image', image);

    try {
      const response = await axios.post(`${API_URL}/upload`, formData);
      
      if (response.data.message) {
        setMessage(response.data.message);
      }
      
      if (response.data.results && response.data.results.length > 0) {
        setResults(response.data.results);
        
        // Add to image history
        const timestamp = new Date().toLocaleString();
        const newHistoryItem = {
          id: Date.now(),
          image: preview,
          timestamp,
          results: response.data.results
        };
        
        setImageHistory(prev => [newHistoryItem, ...prev].slice(0, 20)); // Keep max 20 items
        
        // Update recognized persons
        const newPersons = [...recognizedPersons];
        const newUnrecognized = [];
        
        response.data.results.forEach(result => {
          if (result.name !== 'Person not found' && result.confidence > 0) {
            // Check if person already exists in the list
            const existingIndex = newPersons.findIndex(p => p.name === result.name);
            
            if (existingIndex === -1) {
              // Add new person
              newPersons.push({
                name: result.name,
                images: [{ 
                  id: result.id,
                  image: result.face_image,
                  confidence: result.confidence,
                  timestamp 
                }]
              });
            } else {
              // Check if this exact image already exists for this person (by comparing base64)
              const isDuplicate = newPersons[existingIndex].images.some(
                img => img.image === result.face_image
              );
              
              // Only add face if it's not a duplicate
              if (!isDuplicate) {
                // Add face to existing person
                newPersons[existingIndex].images = [
                  { 
                    id: result.id,
                    image: result.face_image,
                    confidence: result.confidence,
                    timestamp 
                  },
                  ...newPersons[existingIndex].images
                ].slice(0, 20); // Keep max 20 images per person
              }
            }
          } else if (result.name === 'Person not found') {
            // Add to unrecognized persons
            newUnrecognized.push({
              id: result.id,
              image: result.face_image,
              timestamp,
              facePosition: result.face_position || null
            });
          }
        });
        
        setRecognizedPersons(newPersons);
        
        // Deduplicate unrecognized faces by checking image data
        setUnrecognizedPersons(prev => {
          const combinedUnrecognized = [...newUnrecognized, ...prev];
          
          // Use a map to track unique images
          const uniqueImages = new Map();
          
          // Filter out duplicates based on image data
          const deduplicatedUnrecognized = combinedUnrecognized.filter(face => {
            // If we haven't seen this image before, keep it
            if (!uniqueImages.has(face.image)) {
              uniqueImages.set(face.image, true);
              return true;
            }
            return false;
          });
          
          return deduplicatedUnrecognized.slice(0, 50); // Keep max 50 items
        });
        
        // Refresh persons list
        fetchPersons();
      }
    } catch (error) {
      console.error('Error:', error);
      setError(error.response?.data?.error || error.message || 'An error occurred');
    } finally {
      setLoading(false);
    }
  };

  const deleteHistoryItem = (e, id) => {
    e.stopPropagation(); // Prevent click from bubbling to parent
    
    Swal.fire({
      title: 'Are you sure?',
      text: "You won't be able to revert this!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#7b47e5',
      cancelButtonColor: '#d33',
      confirmButtonText: 'Yes, delete it!'
    }).then((result) => {
      if (result.isConfirmed) {
        // Remove from state
        setImageHistory(prev => prev.filter(item => item.id !== id));
        
        // Update backend
        saveHistoryToBackend();
        
        Swal.fire(
          'Deleted!',
          'The image has been deleted.',
          'success'
        );
      }
    });
  };

  const clearAllHistory = () => {
    Swal.fire({
      title: 'Delete all history?',
      text: "You won't be able to revert this!",
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#7b47e5',
      cancelButtonColor: '#d33',
      confirmButtonText: 'Yes, delete all!'
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          // Call backend API to delete all history
          await axios.post(`${API_URL}/history/delete-all`);
          
          // Clear state
          setImageHistory([]);
          
          Swal.fire(
            'Deleted!',
            'All history has been deleted.',
            'success'
          );
        } catch (error) {
          console.error('Error deleting history:', error);
          Swal.fire(
            'Error!',
            'Failed to delete history.',
            'error'
          );
        }
      }
    });
  };

  const clearAllRecognized = () => {
    if (activeTab === 'recognized') {
      Swal.fire({
        title: 'Delete all recognized persons?',
        text: "You won't be able to revert this!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#7b47e5',
        cancelButtonColor: '#d33',
        confirmButtonText: 'Yes, delete all!'
      }).then(async (result) => {
        if (result.isConfirmed) {
          try {
            // Call backend API to delete all persons
            await axios.post(`${API_URL}/persons/delete-all`);
            
            // Clear state
            setRecognizedPersons([]);
            
            Swal.fire(
              'Deleted!',
              'All recognized persons have been deleted.',
              'success'
            );
          } catch (error) {
            console.error('Error deleting persons:', error);
            Swal.fire(
              'Error!',
              'Failed to delete persons.',
              'error'
            );
          }
        }
      });
    } else {
      Swal.fire({
        title: 'Delete all unrecognized faces?',
        text: "You won't be able to revert this!",
        icon: 'warning',
        showCancelButton: true,
        confirmButtonColor: '#7b47e5',
        cancelButtonColor: '#d33',
        confirmButtonText: 'Yes, delete all!'
      }).then(async (result) => {
        if (result.isConfirmed) {
          try {
            // Call backend API to delete all unrecognized faces
            await axios.post(`${API_URL}/faces/delete-all`);
            
            // Clear state
            setUnrecognizedPersons([]);
            
            Swal.fire(
              'Deleted!',
              'All unrecognized faces have been deleted.',
              'success'
            );
          } catch (error) {
            console.error('Error deleting faces:', error);
            Swal.fire(
              'Error!',
              'Failed to delete faces.',
              'error'
            );
          }
        }
      });
    }
  };
  
  const openImageModal = (imageSrc) => {
    setModalImage(imageSrc);
    setShowModal(true);
  };
  
  const closeModal = () => {
    setShowModal(false);
    setModalImage(null);
  };
  
  // Open person management modal for an unrecognized face
  const openPersonModal = (face) => {
    setSelectedFace(face);
    setPersonModal(true);
    
    // Reset to empty string first
    setSelectedPersonName('');
    
    // Default to first person in list if available
    if (allPersons.length > 0) {
      // Small timeout to ensure the value is set after the modal is opened
      setTimeout(() => {
        setSelectedPersonName(allPersons[0]);
      }, 50);
    }
  };
  
  const closePersonModal = () => {
    setPersonModal(false);
    setSelectedFace(null);
    setNewPersonName('');
    setSelectedPersonName('');
  };
  
  // Create a new person with the unrecognized face
  const handleCreatePerson = async () => {
    if (!selectedFace || !newPersonName.trim()) return;
    
    try {
      const response = await axios.post(`${API_URL}/person/create`, {
        faceId: selectedFace.id,
        name: newPersonName.trim()
      });
      
      // Remove from unrecognized
      const updatedUnrecognized = unrecognizedPersons.filter(p => p.id !== selectedFace.id);
      
      // Deduplicate remaining unrecognized faces
      setUnrecognizedPersons(deduplicateUnrecognizedFaces(updatedUnrecognized));
      
      // Check if it was a duplicate
      const isDuplicate = response.data.is_duplicate;
      
      if (!isDuplicate) {
        // Add to recognized persons immediately (only if not a duplicate)
        const timestamp = new Date().toLocaleString();
        const newPerson = {
          name: newPersonName.trim(),
          images: [
            {
              id: selectedFace.id,
              image: selectedFace.image,
              confidence: 100, // New person created with full confidence
              timestamp
            }
          ]
        };
        
        // Check if person already exists
        setRecognizedPersons(prev => {
          const existingPersonIndex = prev.findIndex(p => p.name === newPersonName.trim());
          
          if (existingPersonIndex !== -1) {
            // Person exists, check if this exact image already exists
            const isDuplicate = prev[existingPersonIndex].images.some(
              img => img.image === selectedFace.image
            );
            
            if (!isDuplicate) {
              // Only add if not a duplicate
              const updatedPersons = [...prev];
              updatedPersons[existingPersonIndex].images = [
                {
                  id: selectedFace.id,
                  image: selectedFace.image,
                  confidence: 100,
                  timestamp
                },
                ...updatedPersons[existingPersonIndex].images
              ].slice(0, 20); // Keep max 20 images
              
              return updatedPersons;
            }
            // If duplicate, just return unchanged state
            return prev;
          } else {
            // Add new person
            return [...prev, newPerson];
          }
        });
      }
      
      // Notify if it was a duplicate
      if (isDuplicate) {
        Swal.fire({
          title: 'Duplicate Face',
          text: `This face already exists for ${newPersonName.trim()} and was not added again.`,
          icon: 'info',
          confirmButtonColor: '#7b47e5'
        });
      }
      
      // Also refresh persons list from backend
      fetchPersons();
      
      setMessage(response.data.message);
      closePersonModal();
      
      // Switch to recognized tab to show the new person
      setActiveTab('recognized');
    } catch (error) {
      console.error('Error creating person:', error);
      setError(error.response?.data?.error || error.message || 'Failed to create person');
    }
  };
  
  // Add face to existing person
  const handleAddToPerson = async () => {
    if (!selectedFace || !selectedPersonName) return;
    
    try {
      const response = await axios.post(`${API_URL}/person/add`, {
        faceId: selectedFace.id,
        personName: selectedPersonName
      });
      
      // Remove from unrecognized
      const updatedUnrecognized = unrecognizedPersons.filter(p => p.id !== selectedFace.id);
      
      // Deduplicate remaining unrecognized faces
      setUnrecognizedPersons(deduplicateUnrecognizedFaces(updatedUnrecognized));
      
      // Check if it was a duplicate
      const isDuplicate = response.data.is_duplicate;
      
      if (!isDuplicate) {
        // Add to recognized person immediately (only if not a duplicate)
        const timestamp = new Date().toLocaleString();
        
        setRecognizedPersons(prev => {
          const existingPersonIndex = prev.findIndex(p => p.name === selectedPersonName);
          
          if (existingPersonIndex !== -1) {
            // Check if this exact image already exists
            const isDuplicate = prev[existingPersonIndex].images.some(
              img => img.image === selectedFace.image
            );
            
            if (!isDuplicate) {
              // Only add if not a duplicate
              const updatedPersons = [...prev];
              updatedPersons[existingPersonIndex].images = [
                {
                  id: selectedFace.id,
                  image: selectedFace.image,
                  confidence: 100,
                  timestamp
                },
                ...updatedPersons[existingPersonIndex].images
              ].slice(0, 20); // Keep max 20 images
              
              return updatedPersons;
            }
            // If duplicate, just return unchanged state
            return prev;
          }
          
          // Should never reach here, but just in case
          return prev;
        });
      }
      
      // Notify if it was a duplicate
      if (isDuplicate) {
        Swal.fire({
          title: 'Duplicate Face',
          text: `This face already exists for ${selectedPersonName} and was not added again.`,
          icon: 'info',
          confirmButtonColor: '#7b47e5'
        });
      }
      
      // Also refresh persons list from backend
      fetchPersons();
      
      setMessage(response.data.message);
      closePersonModal();
      
      // Switch to recognized tab to show the updated person
      setActiveTab('recognized');
    } catch (error) {
      console.error('Error adding to person:', error);
      setError(error.response?.data?.error || error.message || 'Failed to add to person');
    }
  };

  // Add a new function to handle deleting a face from a person
  const deleteFaceFromPerson = (e, personName, faceId, faceImage) => {
    e.stopPropagation(); // Prevent opening the image modal
    
    Swal.fire({
      title: 'Delete Face?',
      html: `
        <p>Are you sure you want to delete this face from <strong>${personName}</strong>?</p>
        <div style="padding: 10px; text-align: center;">
          <img src="${faceImage}" alt="Face" style="max-width: 100px; border-radius: 4px;"/>
        </div>
      `,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#7b47e5',
      cancelButtonColor: '#d33',
      confirmButtonText: 'Yes, delete it!'
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          const response = await axios.post(`${API_URL}/face/delete-from-person`, {
            personName,
            faceId
          });
          
          // Remove the face from the state
          setRecognizedPersons(prev => {
            // Find the person in the list
            const personIndex = prev.findIndex(p => p.name === personName);
            
            if (personIndex === -1) return prev;
            
            // Make a copy of the state
            const updatedPersons = [...prev];
            
            // Remove the face from the person's images
            updatedPersons[personIndex].images = updatedPersons[personIndex].images.filter(
              img => img.id !== faceId
            );
            
            // If this was the last face, remove the person
            if (updatedPersons[personIndex].images.length === 0) {
              updatedPersons.splice(personIndex, 1);
            }
            
            return updatedPersons;
          });
          
          // Also refresh persons list from backend
          fetchPersons();
          
          Swal.fire(
            'Deleted!',
            'The face has been deleted.',
            'success'
          );
        } catch (error) {
          console.error('Error deleting face:', error);
          Swal.fire(
            'Error!',
            error.response?.data?.error || 'Failed to delete face',
            'error'
          );
        }
      }
    });
  };

  // Add a handler for deleting a person
  const deletePerson = (e, personName) => {
    e.stopPropagation(); // Prevent any other event from firing
    
    Swal.fire({
      title: 'Delete Person?',
      text: `Are you sure you want to delete ${personName} and all their face images?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#7b47e5',
      cancelButtonColor: '#d33',
      confirmButtonText: 'Yes, delete it!'
    }).then(async (result) => {
      if (result.isConfirmed) {
        try {
          const response = await axios.post(`${API_URL}/person/delete`, {
            personName
          });
          
          // Remove from recognized persons
          setRecognizedPersons(prev => prev.filter(p => p.name !== personName));
          
          // Also refresh persons list from backend
          fetchPersons();
          
          Swal.fire(
            'Deleted!',
            `${personName} has been deleted.`,
            'success'
          );
        } catch (error) {
          console.error('Error deleting person:', error);
          Swal.fire(
            'Error!',
            error.response?.data?.error || 'Failed to delete person',
            'error'
          );
        }
      }
    });
  };

  return (
    <div className="app-container">
      {/* Left sidebar - Image History */}
      <div className="sidebar history-sidebar">
        <div className="sidebar-header">
          <h3>Upload History</h3>
          {imageHistory.length > 0 && (
            <button className="clear-btn" onClick={clearAllHistory}>Clear All</button>
          )}
        </div>
        
        <div className="history-list">
          {imageHistory.length === 0 ? (
            <p className="empty-message">No upload history</p>
          ) : (
            imageHistory.map(item => (
              <div 
                key={item.id} 
                className="history-item"
                onClick={() => openImageModal(item.image)}
              >
                <div className="history-image-container">
                  <img src={item.image} alt="History" className="history-image" />
                </div>
                <div className="history-details">
                  <p className="history-timestamp">{item.timestamp}</p>
                  <p className="history-count">
                    {item.results.length} face{item.results.length !== 1 ? 's' : ''} detected
                  </p>
                </div>
                <button 
                  className="delete-btn" 
                  onClick={(e) => deleteHistoryItem(e, item.id)}
                >
                  &times;
                </button>
              </div>
            ))
          )}
        </div>
      </div>
      
      {/* Main content area */}
      <div className="main-content">
        <div className="upload-container">
          <div className="upload-card">
            <h1>Face Recognition System</h1>
            <p className="subtitle">Upload an image to identify faces</p>
            
            <div className="upload-area">
              <label className="file-input-label">
                <span className="btn-text">Choose Image</span>
                <input 
                  type="file" 
                  accept="image/jpeg,image/jpg,image/png" 
                  onChange={handleChange} 
                  className="file-input"
                />
              </label>
              
              {preview && (
                <div className="preview-container">
                  <img src={preview} alt="Preview" className="image-preview" />
                </div>
              )}
              
              <button 
                onClick={handleUpload} 
                className="upload-button"
                disabled={!image || loading}
              >
                {loading ? 'Processing...' : 'Recognize Faces'}
              </button>
            </div>
                
            {error && (
              <div className="error-container">
                <p className="error-message">{error}</p>
              </div>
            )}
                
            {message && (
              <div className="message-container">
                <p className="info-message">{message}</p>
              </div>
            )}
        
            {results.length > 0 && (
              <div className="results-container">
                <h3>Recognition Results:</h3>
                <div className="results-list">
                  {results.map((result, index) => (
                    <div key={index} className="result-item" onClick={() => openImageModal(result.face_image)} style={{cursor: 'pointer'}}>
                      <div className="result-image">
                        <img src={result.face_image} alt="Face" />
                      </div>
                      <div className="result-details">
                        <div className="result-name">{result.name}</div>
                        {result.confidence > 0 && (
                          <div className="result-confidence">
                            Confidence: {result.confidence}%
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      
      {/* Right sidebar - Persons */}
      <div className="sidebar persons-sidebar">
        <div className="sidebar-header">
          <h3>Persons</h3>
          {((activeTab === 'recognized' && recognizedPersons.length > 0) || 
            (activeTab === 'unrecognized' && unrecognizedPersons.length > 0)) && (
            <button className="clear-btn" onClick={clearAllRecognized}>Clear All</button>
          )}
        </div>
        
        <div className="tab-container">
          <button 
            className={`tab-button ${activeTab === 'recognized' ? 'active' : ''}`}
            onClick={() => setActiveTab('recognized')}
          >
            Recognized
          </button>
          <button 
            className={`tab-button ${activeTab === 'unrecognized' ? 'active' : ''}`}
            onClick={() => setActiveTab('unrecognized')}
          >
            Unrecognized
          </button>
        </div>
        
        <div className="persons-list">
          {activeTab === 'recognized' ? (
            recognizedPersons.length === 0 ? (
              <p className="empty-message">No persons recognized</p>
            ) : (
              recognizedPersons.map((person, index) => (
                <div key={index} className="person-folder">
                  <div className="person-folder-header">
                    <h4 className="person-name">{person.name}</h4>
                    <div className="person-actions">
                      <span className="person-count">{person.images?.length || 0} images</span>
                      <button 
                        className="delete-person-btn"
                        onClick={(e) => deletePerson(e, person.name)}
                        title="Delete person"
                      >
                        &times;
                      </button>
                    </div>
                  </div>
                  <div className="person-images">
                    {person.images?.map((img, imgIndex) => (
                      <div 
                        key={imgIndex} 
                        className="person-image-thumb"
                        onClick={() => openImageModal(img.image)}
                      >
                        <img src={img.image} alt={person.name} />
                        <button 
                          className="delete-face-btn" 
                          onClick={(e) => deleteFaceFromPerson(e, person.name, img.id, img.image)}
                          title="Delete this face"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )
          ) : (
            unrecognizedPersons.length === 0 ? (
              <p className="empty-message">No unrecognized persons</p>
            ) : (
              <div className="unrecognized-grid">
                {unrecognizedPersons.map((face) => (
                  <div 
                    key={face.id} 
                    className="unrecognized-item"
                  >
                    <div className="unrecognized-image-container">
                      <img 
                        src={face.image} 
                        alt="Unknown person" 
                        onClick={() => openImageModal(face.image)}
                        style={{cursor: 'pointer'}}
                      />
                      <button 
                        className="add-person-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          openPersonModal(face);
                        }}
                      >
                        +
                      </button>
                    </div>
                    <div className="unrecognized-timestamp">
                      {face.timestamp}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>
      
      {/* Image Modal */}
      {showModal && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <img src={modalImage} alt="Enlarged view" className="modal-image" />
            <button className="modal-close" onClick={closeModal}>&times;</button>
          </div>
        </div>
      )}
      
      {/* Person Management Modal */}
      {personModal && selectedFace && (
        <div className="modal-overlay" onClick={closePersonModal}>
          <div className="person-modal-content" onClick={e => e.stopPropagation()}>
            <h3>Manage Face</h3>
            
            <div className="modal-face-preview">
              <img src={selectedFace.image} alt="Face" />
            </div>
            
            <div className="person-actions">
              <div className="action-section">
                <h4>Add to Existing Person</h4>
                <div className="person-select-container">
                  <select 
                    value={selectedPersonName}
                    onChange={(e) => setSelectedPersonName(e.target.value)}
                    className="person-select"
                  >
                    <option value="" disabled>Select a person</option>
                    {allPersons.map((name, index) => (
                      <option key={index} value={name}>{name}</option>
                    ))}
                  </select>
                  <button 
                    className="action-btn"
                    onClick={handleAddToPerson}
                    disabled={!selectedPersonName}
                  >
                    Add to Person
                  </button>
                </div>
              </div>
              
              <div className="action-section">
                <h4>Create New Person</h4>
                <div className="new-person-container">
                  <input
                    type="text"
                    value={newPersonName}
                    onChange={(e) => setNewPersonName(e.target.value)}
                    placeholder="Person Name"
                    className="person-input"
                  />
                  <button 
                    className="action-btn create-btn"
                    onClick={handleCreatePerson}
                    disabled={!newPersonName.trim()}
                  >
                    Create Person
                  </button>
                </div>
              </div>
            </div>
            
            <button className="modal-close" onClick={closePersonModal}>&times;</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Upload;
