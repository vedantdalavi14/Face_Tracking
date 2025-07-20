
"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

const dbName = 'face-tracker-db';
const storeName = 'recorded-videos';

const openDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);
    request.onerror = () => reject('Error opening IndexedDB');
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { autoIncrement: true });
      }
    };
  });
};

const saveVideoToDB = async (blob: Blob): Promise<IDBValidKey> => {
  const db = await openDB();
  const transaction = db.transaction(storeName, 'readwrite');
  const store = transaction.objectStore(storeName);
  const request = store.add(blob);
  return new Promise<IDBValidKey>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
};

const getVideosFromDB = async (): Promise<{ key: IDBValidKey; blob: Blob }[]> => {
    const db = await openDB();
    const transaction = db.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.openCursor();
    const results: { key: IDBValidKey; blob: Blob }[] = [];

    return new Promise((resolve, reject) => {
        request.onsuccess = (event) => {
            const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
            if (cursor) {
                results.push({ key: cursor.primaryKey, blob: cursor.value });
                cursor.continue();
            } else {
                resolve(results);
            }
        };
        request.onerror = () => reject(request.error);
    });
};

const deleteVideoFromDB = async (key: IDBValidKey) => {
  const db = await openDB();
  const transaction = db.transaction(storeName, 'readwrite');
  const store = transaction.objectStore(storeName);
  const request = store.delete(key);
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    request.onerror = () => reject(request.error);
  });
};


const FaceTracker = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedVideos, setRecordedVideos] = useState<{ key: IDBValidKey; url: string }[]>([]);
  const recordedVideosRef = useRef(recordedVideos);
  recordedVideosRef.current = recordedVideos;

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const faceDetectorRef = useRef<FaceDetector | null>(null);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const audioStreamRef = useRef<MediaStream | null>(null);

  const predictWebcam = useCallback(() => {
    if (!videoRef.current || !faceDetectorRef.current) return;

    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const canvasCtx = canvas.getContext('2d');
    if (!canvasCtx) return;

    let lastTime = -1;
    const renderLoop = () => {
      const now = performance.now();
      if (now > lastTime) {
        if (faceDetectorRef.current && video.readyState === 4) {
          const detections = faceDetectorRef.current.detectForVideo(video, Date.now());
          
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;

          canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
          canvasCtx.drawImage(video, 0, 0, canvas.width, canvas.height);

          if (detections && detections.detections) {
            for (const detection of detections.detections) {
              const { boundingBox } = detection;
              if (boundingBox) {
                canvasCtx.strokeStyle = '#FF0000';
                canvasCtx.lineWidth = 2;
                canvasCtx.strokeRect(
                  boundingBox.originX,
                  boundingBox.originY,
                  boundingBox.width,
                  boundingBox.height
                );
              }
            }
          }
        }
      }
      lastTime = now;
      requestAnimationFrame(renderLoop);
    };

    renderLoop();
  }, []);

  const startWebcam = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 1280, height: 720 },
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.addEventListener('loadeddata', predictWebcam);
      }
    } catch (error) {
      console.error('Error accessing webcam:', error);
    }
  }, [predictWebcam]);

  useEffect(() => {
    const initFaceDetector = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );
        faceDetectorRef.current = await FaceDetector.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
            delegate: 'GPU',
          },
          runningMode: 'VIDEO',
        });
        startWebcam();
      } catch (error) {
        console.error('Error initializing face detector:', error);
      }
    };
    initFaceDetector();
  }, [startWebcam]);

  const handleToggleAudio = async () => {
    if (audioEnabled) {
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach(track => track.stop());
        audioStreamRef.current = null;
      }
      setAudioEnabled(false);
    } else {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioStreamRef.current = stream;
        setAudioEnabled(true);
      } catch (error) {
        console.error('Error accessing microphone:', error);
        alert('Could not access the microphone. Please check your browser permissions.');
      }
    }
  };

  const handleStartRecording = () => {
    if (canvasRef.current) {
      const stream = canvasRef.current.captureStream();
      if (audioEnabled && audioStreamRef.current) {
        const audioTracks = audioStreamRef.current.getAudioTracks();
        if (audioTracks.length > 0) {
            stream.addTrack(audioTracks[0]);
        }
      }
      mediaRecorderRef.current = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mediaRecorderRef.current.ondataavailable = (event) => {
        chunks.push(event.data);
      };
      mediaRecorderRef.current.onstop = async () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        try {
          const key = await saveVideoToDB(blob);
          const url = URL.createObjectURL(blob);
          setRecordedVideos((prevVideos) => [...prevVideos, { key, url }]);
        } catch (error) {
          console.error('Failed to save video:', error);
        }
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  };

  const handleDeleteVideo = async (key: IDBValidKey, url: string) => {
    try {
      await deleteVideoFromDB(key);
      setRecordedVideos((prevVideos) => {
        const newVideos = prevVideos.filter((video) => video.key !== key);
        URL.revokeObjectURL(url);
        return newVideos;
      });
    } catch (error) {
      console.error('Failed to delete video:', error);
    }
  };

  useEffect(() => {
    const loadVideos = async () => {
      try {
        const videosFromDB = await getVideosFromDB();
        const videoUrls = videosFromDB.map(({ key, blob }) => ({
          key,
          url: URL.createObjectURL(blob),
        }));
        setRecordedVideos(videoUrls);
      } catch (error) {
        console.error('Failed to load videos from DB:', error);
      }
    };
    loadVideos();

    return () => {
      recordedVideosRef.current.forEach((video) => URL.revokeObjectURL(video.url));
      if (audioStreamRef.current) {
        audioStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  return (
    <div className="flex flex-col min-h-screen w-full bg-[#0D1117] text-gray-200 font-sans">
      <nav className="w-full bg-[#161B22]/80 backdrop-blur-sm border-b border-gray-800 shadow-md sticky top-0 z-50">
          <div className="w-full max-w-6xl mx-auto flex justify-center items-center p-4">
              <div className="relative inline-block">
                  <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-indigo-500 pb-2">
                  Face Tracker
                  </h1>
                  <div className="absolute bottom-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-indigo-500 rounded-full" />
              </div>
          </div>
      </nav>

      <main className="w-full max-w-6xl mx-auto flex-1 flex flex-col items-center p-4 sm:p-6 lg:p-8 mt-10">
        <div className="w-full max-w-4xl p-0.5 rounded-2xl bg-gradient-to-br from-purple-600 via-indigo-500 to-blue-500 shadow-2xl shadow-indigo-500/10">
            <div className="relative bg-[#161B22] rounded-[15px] overflow-hidden">
                <div className="absolute top-4 left-4 z-10 bg-red-500/80 text-white px-3 py-1 rounded-full text-sm font-semibold flex items-center gap-2 border border-red-400/50">
                    <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500"></span>
                    </span>
                    LIVE
                </div>
                <video ref={videoRef} autoPlay playsInline className="w-full h-auto aspect-video block" />
                <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full" />
            </div>
        </div>

        <div className="flex items-center gap-4 my-8">
            <button
                onClick={handleToggleAudio}
                className={`flex items-center justify-center p-3 rounded-full transition-all duration-300 transform hover:scale-110 border ${
                audioEnabled 
                    ? 'bg-green-500/20 border-green-500 shadow-[0_0_15px_rgba(74,222,128,0.3)]' 
                    : 'bg-gray-800 hover:bg-gray-700 border-gray-600'
                }`}
                title={audioEnabled ? 'Disable Microphone' : 'Enable Microphone'}
            >
                {audioEnabled ? (
                    <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path>
                    </svg>
                ) : (
                    <svg className="w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"></path>
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5l14 14"></path>
                    </svg>
                )}
            </button>
            {!isRecording ? (
              <button
                onClick={handleStartRecording}
                className="flex items-center justify-center gap-2 bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-full transition-all duration-300 transform hover:scale-105 border border-green-500 shadow-[0_0_15px_rgba(74,222,128,0.3)] active:scale-100"
              >
                <svg className="w-6 h-6 text-green-400" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"></path></svg>
                <span>Record</span>
              </button>
            ) : (
              <button
                onClick={handleStopRecording}
                className="flex items-center justify-center gap-2 bg-red-900/50 text-white font-bold py-3 px-6 rounded-full transition-all duration-300 transform hover:scale-105 border border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.4)] animate-pulse"
              >
                <svg className="w-5 h-5 text-red-400" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path d="M10 18a8 8 0 100-16 8 8 0 000 16zM8 10a2 2 0 114 0 2 2 0 01-4 0z"></path></svg>
                <span>Recording...</span>
              </button>
            )}
        </div>
        
        <div className="w-full mt-8">
            <h2 className="text-2xl sm:text-3xl font-bold mb-8 text-center text-gray-200">Recorded Videos</h2>
            {recordedVideos.length > 0 ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
                    {recordedVideos.map((video, index) => (
                        <div key={video.key.toString()} className="p-0.5 rounded-xl bg-gradient-to-br from-purple-600/70 via-indigo-600/70 to-blue-600/70 group transform hover:-translate-y-2 transition-all duration-300 hover:shadow-2xl hover:shadow-indigo-500/30">
                            <div className="bg-[#161B22] p-4 rounded-[11px] h-full flex flex-col">
                                <div className="aspect-video rounded-lg overflow-hidden mb-4">
                                    <video src={video.url} controls className="w-full h-full object-cover" />
                                </div>
                                <div className="flex justify-between items-center mt-auto">
                                    <span className="font-semibold text-gray-300">Recording #{index + 1}</span>
                                    <div className="flex items-center gap-2">
                                        <a
                                            href={video.url}
                                            download={`recording-${index + 1}.webm`}
                                            className="flex items-center gap-2 text-sm text-indigo-300 hover:text-indigo-200 font-semibold py-2 px-3 rounded-lg bg-indigo-500/10 hover:bg-indigo-500/20 transition-all duration-300"
                                        >
                                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                                            Download
                                        </a>
                                        <button 
                                          onClick={() => handleDeleteVideo(video.key, video.url)}
                                          className="flex items-center gap-2 text-sm text-red-400 hover:text-red-300 font-semibold py-2 px-3 rounded-lg bg-red-500/10 hover:bg-red-500/20 transition-all duration-300"
                                          title="Delete Video"
                                        >
                                            <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor">
                                                <path d="M7 4a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2h4a1 1 0 1 1 0 2h-1.069l-.867 12.142A2 2 0 0 1 18.069 22H5.93a2 2 0 0 1-1.995-1.858L3.07 8H2a1 1 0 1 1 0-2h4V4zm2 2h6V4H9v2zM5.071 8l.857 12H18.07l.857-12H5.07z"/>
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <div className="p-0.5 rounded-xl bg-gradient-to-br from-purple-600/70 via-indigo-600/70 to-blue-600/70">
                    <div className="text-center py-16 px-6 bg-[#161B22] rounded-[11px] border border-dashed border-gray-700">
                        <svg className="mx-auto h-12 w-12 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 10l4.55a2 2 0 01.45 2.122l-1.55 4.5A2 2 0 0116.55 18H7.45a2 2 0 01-1.9-1.378l-1.55-4.5A2 2 0 014.45 10H15zM15 10V5a2 2 0 00-2-2H9a2 2 0 00-2 2v5" />
                        </svg>
                        <h3 className="mt-4 text-xl font-semibold text-white">No recordings yet</h3>
                        <p className="mt-2 text-base text-gray-400">Click the &apos;Record&apos; button to start.</p>
                    </div>
                </div>
            )}
        </div>
      </main>
    </div>
  );
};

export default FaceTracker; 