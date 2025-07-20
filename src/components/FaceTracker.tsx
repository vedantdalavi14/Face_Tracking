
"use client";

import React, { useEffect, useRef, useState } from 'react';
import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision';

const FaceTracker = () => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordedVideos, setRecordedVideos] = useState<string[]>([]);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const faceDetectorRef = useRef<FaceDetector | null>(null);

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
  }, []);

  const startWebcam = async () => {
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
  };

  const predictWebcam = () => {
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
  };

  const handleStartRecording = () => {
    if (canvasRef.current) {
      const stream = canvasRef.current.captureStream();
      mediaRecorderRef.current = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      mediaRecorderRef.current.ondataavailable = (event) => {
        chunks.push(event.data);
      };
      mediaRecorderRef.current.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const newVideos = [...recordedVideos, url];
        setRecordedVideos(newVideos);
        localStorage.setItem('recordedVideos', JSON.stringify(newVideos));
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

  useEffect(() => {
    const videos = JSON.parse(localStorage.getItem('recordedVideos') || '[]');
    setRecordedVideos(videos);
  }, []);

  return (
    <div className="flex flex-col items-center min-h-screen bg-gray-900 text-white p-4">
      <h1 className="text-4xl font-bold mb-4">Face Tracker</h1>
      <div className="relative w-full max-w-4xl border-4 border-blue-500 rounded-lg shadow-lg">
        <video ref={videoRef} autoPlay playsInline className="w-full h-full rounded-lg" />
        <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full" />
      </div>
      <div className="mt-4">
        {!isRecording ? (
          <button
            onClick={handleStartRecording}
            className="bg-green-500 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-full transition-transform transform hover:scale-110"
          >
            Start Recording
          </button>
        ) : (
          <button
            onClick={handleStopRecording}
            className="bg-red-500 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-full transition-transform transform hover:scale-110"
          >
            Stop Recording
          </button>
        )}
      </div>
      <div className="mt-8 w-full max-w-4xl">
        <h2 className="text-2xl font-bold mb-4">Recorded Videos</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {recordedVideos.map((videoUrl, index) => (
            <div key={index} className="bg-gray-800 p-4 rounded-lg shadow-md">
              <video src={videoUrl} controls className="w-full rounded-lg" />
              <a
                href={videoUrl}
                download={`recorded-video-${index}.webm`}
                className="text-blue-400 hover:text-blue-600 mt-2 inline-block"
              >
                Download
              </a>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FaceTracker; 