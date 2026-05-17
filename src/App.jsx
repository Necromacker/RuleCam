import * as React from 'react';
import './App.css';
const { useEffect, useRef, useState, useCallback } = React;

const rawBackendUrl = import.meta.env.VITE_BACKEND_URL || "http://localhost:5005";
const BACKEND_URL = rawBackendUrl.replace(/\/$/, "");

const App = () => {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const overlayCanvasRef = useRef(null);
  const isMonitoringSignalRef = useRef(false);
  const isMonitoringTripleRef = useRef(false);
  const loopTimeoutRef = useRef(null);

  const [activeTab, setActiveTab] = useState("home");
  const [facingMode, setFacingMode] = useState("environment");
  const [detections, setDetections] = useState([]);
  const [isMonitoringSignal, setIsMonitoringSignal] = useState(false);
  const [isMonitoringTriple, setIsMonitoringTriple] = useState(false);
  const [backendStatus, setBackendStatus] = useState("checking");
  const [fps, setFps] = useState(0);
  const [detectionMode, setDetectionMode] = useState("signal_jumping"); // "signal_jumping" or "triple_riding"
  const [error, setError] = useState(null);
  const [violations, setViolations] = useState([]);
  const [isViolationFound, setIsViolationFound] = useState(false);
  const [isReporting, setIsReporting] = useState(false);
  const [lightState, setLightState] = useState("unknown");
  const [videoBlob, setVideoBlob] = useState(null);
  const [isAutoReporting, setIsAutoReporting] = useState(false);
  const mediaRecorderRef = useRef(null);
  const recordedChunksRef = useRef([]);

  // Chatbot State
  const [chatMessages, setChatMessages] = useState([
    { sender: 'bot', text: "Hello! Upload a video of a traffic violation, and our VideoDB AI will analyze it to detect the vehicle and the rules broken." }
  ]);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);
  const scanningFileInputRef = useRef(null);
  const hasUploadedCurrentViolationRef = useRef(false);
  
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isNotifOpen, setIsNotifOpen] = useState(false);
  const [isMessageOpen, setIsMessageOpen] = useState(false);
  
  const [uploadedVideoUrl, setUploadedVideoUrl] = useState(null);
  const [uploadedVideoName, setUploadedVideoName] = useState(null);
  const [rawVideoFile, setRawVideoFile] = useState(null);

  
  // Specific Video Chat States
  const [videoChats, setVideoChats] = useState({});
  const [chatInputs, setChatInputs] = useState({});
  const [isVideoChatting, setIsVideoChatting] = useState({});

  const notifications = [
    { id: 1, title: 'New Signal Violation', desc: 'A vehicle crossed red light at intersection 4', time: '2m ago' },
    { id: 2, title: 'System Update', desc: 'AI model updated to v2.4', time: '1h ago' }
  ];

  const messages = [
    { id: 1, sender: 'Admin', text: 'Please review the latest reports.', time: '10:00 AM' },
    { id: 2, sender: 'Support', text: 'Server maintenance scheduled for tonight.', time: 'Yesterday' }
  ];

  // Live Monitor Direct File Upload (JUST loads the video without any background AI/VideoDB analysis)
  const handleFileSelectForScanning = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    console.log(`[Scanning] Loading custom video: '${file.name}' (${Math.round(file.size / 1024)} KB) for rule scanning...`);
    const url = URL.createObjectURL(file);
    setUploadedVideoUrl(url);
    setUploadedVideoName(file.name);
    setRawVideoFile(file);
    setActiveTab("live");

    // Reset uploading states to ensure clean environment
    setIsUploading(false);
  };

  // Chatbot File Upload Logic
  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Set uploaded video URL for live scanning and auto-switch to Live Monitor tab
    const url = URL.createObjectURL(file);
    setUploadedVideoUrl(url);
    setUploadedVideoName(file.name);
    setRawVideoFile(file);
    setActiveTab("live");

    setChatMessages(prev => [...prev, { sender: 'user', text: `Uploaded: ${file.name}` }]);
    setIsUploading(true);

    const formData = new FormData();
    formData.append('media', file);
    formData.append('type', "Manual VideoDB Upload");

    try {
      console.log(`[VideoDB Process] Uploading Video File: '${file.name}' - Size: ${Math.round(file.size / 1024)} KB to Flask backend /report_violation...`);
      setChatMessages(prev => [...prev, { sender: 'bot', text: "Uploading and processing with VideoDB AI... This might take a minute." }]);
      
      const startTime = performance.now();
      const res = await fetch(`${BACKEND_URL}/report_violation`, {
        method: 'POST',
        body: formData
      });
      const data = await res.json();
      const elapsed = performance.now() - startTime;
      
      if (res.ok) {
        console.log(`[VideoDB Process] Video uploaded successfully in ${Math.round(elapsed)}ms. Received Record ID: ${data.id}. Starting real-time AI context analysis polling...`);
        const recordId = data.id;
        // Poll for AI analysis
        const pollInterval = setInterval(async () => {
          console.log(`[VideoDB Process] Polling backend for AI analysis status of Record ID: ${recordId}...`);
          const vRes = await fetch(`${BACKEND_URL}/violations`);
          const vData = await vRes.json();
          const record = vData.find(v => v.id === recordId);
          
          if (record && record.ai_analysis && record.status !== 'Pending') {
            console.log(`[VideoDB Process] Polling Finished! Final Status: ${record.status}`);
            console.log(`  └─ AI Context Analysis: "${record.ai_analysis}"`);
            if (record.status === 'Confirmed') {
              setChatMessages(prev => [...prev, { sender: 'bot', text: `Analysis Complete: Violation Confirmed! ${record.ai_analysis}` }]);
            } else {
              setChatMessages(prev => [...prev, { sender: 'bot', text: `Analysis Complete: AI did not confirm a violation.` }]);
            }
            clearInterval(pollInterval);
            setIsUploading(false);
            fetchViolations(); // refresh history
          } else if (record && record.ai_analysis && record.ai_analysis !== "Processing") {
            console.log(`[VideoDB Process] Progress Update: "${record.ai_analysis}"`);
            setChatMessages(prev => {
              const newMsgs = [...prev];
              const lastMsg = newMsgs[newMsgs.length - 1];
              if (lastMsg.sender === 'bot' && lastMsg.isProgress) {
                lastMsg.text = record.ai_analysis;
              } else {
                newMsgs.push({ sender: 'bot', text: record.ai_analysis, isProgress: true });
              }
              return newMsgs;
            });
          }
        }, 5000);
      } else {
        console.error(`[VideoDB Process] Upload failed:`, data.error);
        setChatMessages(prev => [...prev, { sender: 'bot', text: `Upload failed: ${data.error || "Server error"}` }]);
        setIsUploading(false);
      }
    } catch (err) {
      console.error("[VideoDB Process] Error in upload/analysis:", err);
      setChatMessages(prev => [...prev, { sender: 'bot', text: `Error uploading video: ${err.message}` }]);
      setIsUploading(false);
    }
  };

  // Check backend health
  useEffect(() => {
    const checkBackend = async () => {
      try {
        const res = await fetch(`${BACKEND_URL}/`);
        if (res.ok) {
          setBackendStatus("connected");
          setError(null);
        } else {
          setBackendStatus("error");
        }
      } catch {
        setBackendStatus("disconnected");
      }
    };
    checkBackend();
    const hInterval = setInterval(checkBackend, 5000);
    return () => clearInterval(hInterval);
  }, []);

  // Fetch Violations History
  const fetchViolations = useCallback(async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/violations`);
      const data = await res.json();
      setViolations(data);
    } catch (err) {
      console.error("Error fetching violations:", err);
    }
  }, []);

  useEffect(() => {
    if (activeTab === "history") {
      fetchViolations();
    }
  }, [activeTab, fetchViolations]);

  // Start camera
  const startVideo = useCallback(async () => {
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach(t => t.stop());
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode, width: { ideal: 640 }, height: { ideal: 480 } }
      });
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(err => console.log("Camera play error:", err));
      }
      setError(null);
    } catch (err) {
      console.error("Camera error:", err);
      setError("Could not access camera. Please grant permissions.");
    }
  }, [facingMode]);

  // Handle video source switching (webcam stream vs. uploaded video file)
  useEffect(() => {
    if (uploadedVideoUrl) {
      // Stop webcam tracks if active
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop());
        videoRef.current.srcObject = null;
      }
      // Load and play the uploaded video file
      if (videoRef.current) {
        videoRef.current.src = uploadedVideoUrl;
        videoRef.current.load(); // Force the browser to load the new video stream
        videoRef.current.loop = false; // Disable looping!
        videoRef.current.muted = true;
        videoRef.current.playsInline = true;
        videoRef.current.pause();
      }
    } else {
      // Clear video element source and start webcam
      if (videoRef.current) {
        videoRef.current.src = "";
        videoRef.current.load(); // Cleanly unload the video blob URL
      }
      startVideo();
    }

    return () => {
      if (videoRef.current && videoRef.current.srcObject) {
        videoRef.current.srcObject.getTracks().forEach(t => t.stop());
      }
      isMonitoringSignalRef.current = false;
      isMonitoringTripleRef.current = false;
      if (loopTimeoutRef.current) {
        clearTimeout(loopTimeoutRef.current);
      }
    };
  }, [uploadedVideoUrl, startVideo]);

  // Draw bounding box overlay
  const drawOverlay = useCallback((dets, imageShape, violationDetected, currentLightState) => {
    const overlay = overlayCanvasRef.current;
    const video = videoRef.current;
    if (!overlay || !video) return;

    overlay.width = video.videoWidth;
    overlay.height = video.videoHeight;
    const ctx = overlay.getContext('2d');
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const colors = {
      'red': '#ff3cac',
      'yellow': '#ffb800',
      'green': '#00ff87',
      'unknown': '#00f0ff'
    };

    const lightColor = colors[currentLightState] || colors.unknown;

    // Draw detected light state indicator (only for signal mode)
    if (currentLightState !== "N/A") {
      ctx.fillStyle = lightColor;
      ctx.beginPath();
      ctx.arc(30, 30, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = 'bold 14px Inter';
      ctx.fillText(`SIGNAL: ${currentLightState.toUpperCase()}`, 50, 35);
    }

    dets.forEach((det, i) => {
      const [x1, y1, x2, y2] = det.bbox;
      const isTrafficLight = det.object === "traffic light";
      const color = det.is_violating ? '#ff3cac' : (isTrafficLight ? lightColor : '#00f0ff');
      const w = x2 - x1;
      const h = y2 - y1;

      ctx.strokeStyle = color;
      ctx.lineWidth = det.is_violating ? 4 : 2.5;
      ctx.shadowColor = color;
      ctx.shadowBlur = det.is_violating ? 15 : 8;
      ctx.strokeRect(x1, y1, w, h);
      ctx.shadowBlur = 0;

      // Label
      const label = isTrafficLight ? `LIGHT: ${currentLightState}` : det.object;
      ctx.font = 'bold 12px Inter';
      const textWidth = ctx.measureText(label).width;
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(x1, y1 - 20, textWidth + 10, 20);
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#000';
      ctx.fillText(label, x1 + 5, y1 - 5);
    });
  }, []);

  // Instant Automatic Violation Upload (called as soon as a violation is flagged in a frame)
  const reportViolationInstant = useCallback(async (dets, isSignalScan) => {
    const potentialViolation = dets.find(d => d.is_violating) || dets.find(d => ["car", "motorcycle", "bus", "truck"].includes(d.object));

    const formData = new FormData();
    formData.append('type', isSignalScan ? 'Signal Jumping' : 'Triple Riding');
    formData.append('vehicle', potentialViolation ? potentialViolation.object : 'Unknown');
    formData.append('confidence', potentialViolation ? potentialViolation.confidence : 0);

    if (canvasRef.current) {
      canvasRef.current.toBlob(async (blob) => {
        if (!blob) return;
        formData.append('media', blob, 'instant_violation.jpg');
        try {
          console.log("[Auto-Upload] Submitting instant violation frame to backend...");
          const res = await fetch(`${BACKEND_URL}/report_violation`, {
            method: 'POST',
            body: formData
          });
          if (res.ok) {
            console.log("[Auto-Upload] Instant violation reported successfully!");
            fetchViolations(); // Refresh SQLite history tab instantly!
          }
        } catch (err) {
          console.error("[Auto-Upload] Error reporting instant violation:", err);
        }
      }, 'image/jpeg', 0.95);
    }
  }, [fetchViolations]);

  // Capture and Detect Signal Jumping
  const captureAndDetectSignal = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return 0;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video.readyState < 2) return 0;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const startTime = performance.now();
    const imageData = canvas.toDataURL('image/jpeg', 0.5);

    try {
      console.log(`[YOLO STREAM] Captured Frame (${canvas.width}x${canvas.height}) - Size: ${Math.round(imageData.length / 1024)} KB. Uploading frame to YOLO backend...`);
      const res = await fetch(`${BACKEND_URL}/detect_signal`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageData }),
      });
      if (!res.ok) throw new Error(`Detection failed with status: ${res.status}`);
      const data = await res.json();
      const elapsed = performance.now() - startTime;
      const currentFps = Math.round(1000 / elapsed);
      console.log(`[YOLO STREAM] Received response in ${Math.round(elapsed)}ms (${currentFps} FPS). Detections found:`, data.detections);
      if (data.detections && data.detections.length > 0) {
        data.detections.forEach((det, i) => {
          console.log(`  └─ Detections[${i}]: Object='${det.object}', Conf=${Math.round(det.confidence * 100)}%, Violating=${det.is_violating}, BBox=[${det.bbox.join(", ")}]`);
        });
      } else {
        console.log("  └─ No objects detected in this frame.");
      }
      console.log(`  └─ Traffic Light State: ${data.traffic_light_state.toUpperCase()}, Violation Detected: ${data.violation_detected}`);

      setDetections(data.detections || []);
      setIsViolationFound(data.violation_detected || false);
      setLightState(data.traffic_light_state || "unknown");
      setFps(currentFps);
      drawOverlay(data.detections || [], data.image_shape, data.violation_detected, data.traffic_light_state);

      // Auto-upload violation frame instantly
      if (data.violation_detected && !hasUploadedCurrentViolationRef.current) {
        hasUploadedCurrentViolationRef.current = true;
        console.log("[Auto-Upload] Instantly reporting detected violation frame...");
        reportViolationInstant(data.detections || [], true);
      }

      return elapsed;
    } catch (err) {
      console.error("[YOLO STREAM] Error uploading frame:", err);
      return 0;
    }
  }, [drawOverlay, reportViolationInstant]);

  // Capture and Detect Triple Riding
  const captureAndDetectTriple = useCallback(async () => {
    if (!videoRef.current || !canvasRef.current) return 0;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (video.readyState < 2) return 0;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0);
    const startTime = performance.now();
    const imageData = canvas.toDataURL('image/jpeg', 0.5);

    try {
      console.log(`[YOLO STREAM] Captured Frame (${canvas.width}x${canvas.height}) - Size: ${Math.round(imageData.length / 1024)} KB. Uploading frame to YOLO backend...`);
      const res = await fetch(`${BACKEND_URL}/detect_triple`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ image: imageData }),
      });
      if (!res.ok) throw new Error(`Detection failed with status: ${res.status}`);
      const data = await res.json();
      const elapsed = performance.now() - startTime;
      const currentFps = Math.round(1000 / elapsed);
      console.log(`[YOLO STREAM] Received response in ${Math.round(elapsed)}ms (${currentFps} FPS). Detections found:`, data.detections);
      if (data.detections && data.detections.length > 0) {
        data.detections.forEach((det, i) => {
          console.log(`  └─ Detections[${i}]: Object='${det.object}', Conf=${Math.round(det.confidence * 100)}%, Violating=${det.is_violating}, BBox=[${det.bbox.join(", ")}]`);
        });
      } else {
        console.log("  └─ No objects detected in this frame.");
      }
      console.log(`  └─ Violation Detected: ${data.violation_detected}`);

      setDetections(data.detections || []);
      setIsViolationFound(data.violation_detected || false);
      setLightState("N/A");
      setFps(currentFps);
      drawOverlay(data.detections || [], data.image_shape, data.violation_detected, "N/A");

      // Auto-upload violation frame instantly
      if (data.violation_detected && !hasUploadedCurrentViolationRef.current) {
        hasUploadedCurrentViolationRef.current = true;
        console.log("[Auto-Upload] Instantly reporting detected violation frame...");
        reportViolationInstant(data.detections || [], false);
      }

      return elapsed;
    } catch (err) {
      console.error("[YOLO STREAM] Error uploading frame:", err);
      return 0;
    }
  }, [drawOverlay, reportViolationInstant]);

  const captureAndDetectSignalLoop = useCallback(async () => {
    if (!isMonitoringSignalRef.current) return;
    await captureAndDetectSignal();
    if (isMonitoringSignalRef.current) {
      loopTimeoutRef.current = setTimeout(captureAndDetectSignalLoop, 0);
    }
  }, [captureAndDetectSignal]);

  const captureAndDetectTripleLoop = useCallback(async () => {
    if (!isMonitoringTripleRef.current) return;
    await captureAndDetectTriple();
    if (isMonitoringTripleRef.current) {
      loopTimeoutRef.current = setTimeout(captureAndDetectTripleLoop, 0);
    }
  }, [captureAndDetectTriple]);

  // Start recording a clip
  const startRecording = useCallback(() => {
    if (!videoRef.current || !videoRef.current.srcObject || mediaRecorderRef.current) return;

    recordedChunksRef.current = [];
    const stream = videoRef.current.srcObject;
    const mimeType = MediaRecorder.isTypeSupported('video/mp4') ? 'video/mp4' : 'video/webm';

    // Use a lower bitrate (1 Mbps) to make uploads faster
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: 1000000
    });

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        recordedChunksRef.current.push(e.data);
      }
    };

    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: mimeType });
      setVideoBlob(blob);
    };

    mediaRecorderRef.current = recorder;
    recorder.start();

    // Stop after 10 seconds
    setTimeout(() => {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
      }
    }, 10000);
  }, []);

  useEffect(() => {
    if (isViolationFound && !mediaRecorderRef.current && !videoBlob && !isAutoReporting) {
      setIsAutoReporting(true);
      startRecording();
    }

    // When a video blob is ready and we are in auto-reporting mode, send it
    if (videoBlob && isAutoReporting) {
      reportViolation();
      setIsAutoReporting(false);
    }

    if (!isViolationFound && !isAutoReporting) {
      setVideoBlob(null);
      if (mediaRecorderRef.current) {
        mediaRecorderRef.current.stop();
        mediaRecorderRef.current = null;
      }
    }
  }, [isViolationFound, startRecording, videoBlob, isAutoReporting]);

  // Report Violation
  const reportViolation = async () => {
    if (isReporting || (!videoBlob && !canvasRef.current)) return;
    setIsReporting(true);

    const potentialViolation = detections.find(d => d.is_violating) || detections.find(d => ["car", "motorcycle", "bus", "truck"].includes(d.object));

    const formData = new FormData();
    formData.append('type', isMonitoringSignal ? 'Signal Jumping' : 'Triple Riding');
    formData.append('vehicle', potentialViolation ? potentialViolation.object : 'Unknown');
    formData.append('confidence', potentialViolation ? potentialViolation.confidence : 0);

    const sendReport = async (blob, filename) => {
      formData.append('media', blob, filename);
      try {
        const res = await fetch(`${BACKEND_URL}/report_violation`, {
          method: 'POST',
          body: formData
        });
        if (res.ok) {
          console.log("Signal jumping clip reported automatically!");
          setIsViolationFound(false);
          setVideoBlob(null);
          fetchViolations();
        }
      } catch (err) {
        console.error("Reporting error:", err);
      } finally {
        setIsReporting(false);
        setIsAutoReporting(false);
      }
    };

    if (videoBlob) {
      const ext = videoBlob.type === 'video/mp4' ? '.mp4' : '.webm';
      sendReport(videoBlob, `violation_clip${ext}`);
    } else {
      canvasRef.current.toBlob((blob) => {
        if (blob) sendReport(blob, 'violation.jpg');
        else setIsReporting(false);
      }, 'image/jpeg', 0.9);
    }
  };

  // Clear All Violations
  const clearViolations = async () => {
    if (!window.confirm("Are you sure you want to delete all violation records and videos?")) return;

    try {
      const res = await fetch(`${BACKEND_URL}/clear_violations`, { method: 'POST' });
      if (res.ok) {
        fetchViolations();
      }
    } catch (err) {
      console.error("Error clearing violations:", err);
    }
  };

  // Delete Single Violation
  const deleteViolation = async (id) => {
    if (!window.confirm("Delete this record?")) return;
    try {
      const res = await fetch(`${BACKEND_URL}/delete_violation/${id}`, { method: 'POST' });
      if (res.ok) {
        fetchViolations();
      }
    } catch (err) {
      console.error("Error deleting violation:", err);
    }
  };

  // Auto-start scanning loop on mount and whenever video source changes
  useEffect(() => {
    // 1. Clean up any existing timeouts first to prevent duplicate loops
    isMonitoringSignalRef.current = false;
    isMonitoringTripleRef.current = false;
    if (loopTimeoutRef.current) {
      clearTimeout(loopTimeoutRef.current);
    }

    if (uploadedVideoUrl) {
      // 2. Set monitoring to true for uploaded videos
      setIsMonitoringSignal(true);
      isMonitoringSignalRef.current = true;

      // 3. Start the frame capture analysis loop
      captureAndDetectSignalLoop();

      // 4. If an uploaded video is loaded, force it to play immediately
      if (videoRef.current) {
        videoRef.current.play().catch(err => console.log("[Auto-Start] Video play error:", err));
      }
    } else {
      // For webcam mode: Reset scanning states to inactive so the user can start manually!
      setIsMonitoringSignal(false);
      setIsMonitoringTriple(false);
    }
  }, [uploadedVideoUrl, captureAndDetectSignalLoop]);

  const toggleSignalMonitoring = () => {
    if (isMonitoringSignalRef.current) {
      isMonitoringSignalRef.current = false;
      setIsMonitoringSignal(false);
      if (loopTimeoutRef.current) {
        clearTimeout(loopTimeoutRef.current);
        loopTimeoutRef.current = null;
      }
      if (uploadedVideoUrl && videoRef.current) {
        videoRef.current.pause();
      }
      setDetections([]);
      setFps(0);
      setIsViolationFound(false);
      const overlay = overlayCanvasRef.current;
      if (overlay) {
        const ctx = overlay.getContext('2d');
        ctx.clearRect(0, 0, overlay.width, overlay.height);
      }
    } else {
      if (isMonitoringTripleRef.current) {
        isMonitoringTripleRef.current = false;
        setIsMonitoringTriple(false);
      }
      isMonitoringSignalRef.current = true;
      setIsMonitoringSignal(true);
      if (uploadedVideoUrl && videoRef.current) {
        videoRef.current.play().catch(err => console.log("Video play error:", err));
      }
      captureAndDetectSignalLoop();
    }
  };

  const toggleTripleMonitoring = () => {
    if (isMonitoringTripleRef.current) {
      isMonitoringTripleRef.current = false;
      setIsMonitoringTriple(false);
      if (loopTimeoutRef.current) {
        clearTimeout(loopTimeoutRef.current);
        loopTimeoutRef.current = null;
      }
      if (uploadedVideoUrl && videoRef.current) {
        videoRef.current.pause();
      }
      setDetections([]);
      setFps(0);
      setIsViolationFound(false);
      const overlay = overlayCanvasRef.current;
      if (overlay) {
        const ctx = overlay.getContext('2d');
        ctx.clearRect(0, 0, overlay.width, overlay.height);
      }
    } else {
      if (isMonitoringSignalRef.current) {
        isMonitoringSignalRef.current = false;
        setIsMonitoringSignal(false);
      }
      isMonitoringTripleRef.current = true;
      setIsMonitoringTriple(true);
      if (uploadedVideoUrl && videoRef.current) {
        videoRef.current.play().catch(err => console.log("Video play error:", err));
      }
      captureAndDetectTripleLoop();
    }
  };

  const toggleCamera = () => {
    setFacingMode(prev => prev === 'user' ? 'environment' : 'user');
  };

  const handleVideoChat = async (videoId) => {
    if (!chatInputs[videoId]) return;
    const question = chatInputs[videoId];
    
    setVideoChats(prev => ({
      ...prev,
      [videoId]: [...(prev[videoId] || []), { sender: 'user', text: question }]
    }));
    setChatInputs(prev => ({ ...prev, [videoId]: '' }));
    setIsVideoChatting(prev => ({ ...prev, [videoId]: true }));
    
    try {
      const res = await fetch(`${BACKEND_URL}/chat_with_video`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_id: videoId, question })
      });
      const data = await res.json();
      setVideoChats(prev => ({
        ...prev,
        [videoId]: [...prev[videoId], { sender: 'bot', text: data.answer || data.error }]
      }));
    } catch (err) {
      setVideoChats(prev => ({
        ...prev,
        [videoId]: [...prev[videoId], { sender: 'bot', text: 'Failed to reach AI.' }]
      }));
    }
    setIsVideoChatting(prev => ({ ...prev, [videoId]: false }));
  };

  return (
    <div className="desktop-app">
      <header className="desktop-header">
        <div className="header-content">
          <div className="header-left">
            <h1 className="app-title">RuleCam</h1>
          </div>
          
          <div className="filter-pills desktop-only">
            <button className={`pill ${activeTab === 'home' ? 'active' : ''}`} onClick={() => setActiveTab('home')}>Home</button>
            <button className={`pill ${activeTab === 'live' ? 'active' : ''}`} onClick={() => setActiveTab('live')}>Live Monitor</button>
            <button className={`pill ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>Violations</button>
          </div>

          <div className="header-actions">
            <button className="icon-btn mobile-menu-btn" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
            </button>
            <div className="dropdown-wrapper">
              <button className="icon-btn" onClick={() => { setIsNotifOpen(!isNotifOpen); setIsMessageOpen(false); }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 8 A6 6 0 0 0 6 8 c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg>
                <span className="badge">2</span>
              </button>
              {isNotifOpen && (
                <div className="popover-dropdown">
                  <div className="popover-header">Notifications</div>
                  <div className="popover-content">
                    {notifications.map(n => (
                      <div key={n.id} className="popover-item">
                        <div className="popover-title">{n.title}</div>
                        <div className="popover-desc">{n.desc}</div>
                        <div className="popover-time">{n.time}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            
            <div className="dropdown-wrapper">
              <button className="icon-btn" onClick={() => { setIsMessageOpen(!isMessageOpen); setIsNotifOpen(false); }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
              </button>
              {isMessageOpen && (
                <div className="popover-dropdown">
                  <div className="popover-header">Messages</div>
                  <div className="popover-content">
                    {messages.map(m => (
                      <div key={m.id} className="popover-item">
                        <div className="popover-title">{m.sender}</div>
                        <div className="popover-desc">{m.text}</div>
                        <div className="popover-time">{m.time}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {isMobileMenuOpen && (
        <div className="mobile-dropdown">
          <button className={`pill ${activeTab === 'home' ? 'active' : ''}`} onClick={() => {setActiveTab('home'); setIsMobileMenuOpen(false);}}>Home</button>
          <button className={`pill ${activeTab === 'live' ? 'active' : ''}`} onClick={() => {setActiveTab('live'); setIsMobileMenuOpen(false);}}>Live Monitor</button>
          <button className={`pill ${activeTab === 'history' ? 'active' : ''}`} onClick={() => {setActiveTab('history'); setIsMobileMenuOpen(false);}}>Violations</button>
        </div>
      )}

      <main className="desktop-content">
        <div className="home-container" style={{ display: activeTab === 'home' ? 'flex' : 'none' }}>
            <div className="home-hero">
              <div className="hero-text">
                <div className="hero-badge-container">
                  <span className="hero-badge yolo">YOLOv8 Real-Time Inference</span>
                  <span className="hero-badge videodb">VideoDB AI Analysis</span>
                  <span className="hero-badge status">Connected</span>
                </div>
                <h1 className="hero-title">Automated Traffic Violation Monitoring</h1>
                <p className="hero-description">
                  RuleCam leverages state-of-the-art YOLOv8 object detection and VideoDB LLM-powered context analysis to detect traffic violations in real-time. Start monitoring or test immediately using our pre-recorded demo video!
                </p>
                <a href="/demo_traffic.mp4" download="demo_traffic.mp4" className="hero-cta">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                  Download Demo Video
                </a>
              </div>
              <div className="hero-visual placeholder-visual">
                <div className="grid-overlay"></div>
                <div className="scanner-line"></div>
                <div className="placeholder-content">
                  <div className="placeholder-radar"></div>
                  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="1.5"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
                  <h3>AI Engine Active</h3>
                  <p>Upload video files or stream live feeds to scan traffic rules.</p>
                </div>
              </div>
            </div>

            <div>
              <h2 className="home-section-title">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2.5"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>
                How to Use RuleCam
              </h2>
              <p className="home-section-subtitle">Get up and running in 4 simple steps using our interactive dashboard</p>
              
              <div className="steps-grid">
                <div className="step-card">
                  <div className="step-number">1</div>
                  <h3 className="step-title">Get Test Material</h3>
                  <p className="step-description">Download our sample video using the button in the hero card, or prepare your own footage showing traffic movement or violations.</p>
                  <div className="step-preview preview-download">
                    <a href="/demo_traffic.mp4" download="demo_traffic.mp4" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', textDecoration: 'none', color: 'var(--text-primary)' }}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--teal)" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                      <span style={{ fontSize: '12px', fontWeight: 700 }}>demo_traffic.mp4</span>
                    </a>
                  </div>
                </div>

                <div className="step-card">
                  <div className="step-number">2</div>
                  <h3 className="step-title">Upload to AI Assistant</h3>
                  <p className="step-description">Navigate to the "Live Monitor" tab. In the right-hand panel, click the "Upload Violation Video" button and select the downloaded demo video.</p>
                  <div className="step-preview preview-upload">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--orange)" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                  </div>
                </div>

                <div className="step-card">
                  <div className="step-number">3</div>
                  <h3 className="step-title">Real-Time Processing</h3>
                  <p className="step-description">The AI backend instantly processes the video using YOLOv8. You'll see real-time updates as bounding boxes are plotted and violation clips are sliced.</p>
                  <div className="step-preview preview-yolo">
                    <div style={{ position: 'relative', width: '90%', height: '80%', border: '1.5px dashed #00f0ff', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ position: 'absolute', top: 4, left: 4, background: '#00f0ff', color: '#000', fontSize: '9px', fontWeight: 'bold', padding: '1px 3px', borderRadius: '2px' }}>car: 94%</div>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#00f0ff" strokeWidth="2"><rect x="1" y="3" width="15" height="13" rx="2" ry="2"></rect><polygon points="16 8 20 8 23 11 23 16 16 16 16 8"></polygon><circle cx="5.5" cy="18.5" r="2.5"></circle><circle cx="18.5" cy="18.5" r="2.5"></circle></svg>
                    </div>
                  </div>
                </div>

                <div className="step-card">
                  <div className="step-number">4</div>
                  <h3 className="step-title">Confirm & Query AI</h3>
                  <p className="step-description">Go to the "Violations" tab to see indexed clips. Check the final AI verdict, click "Chat with AI" to query specific details of the video stream!</p>
                  <div className="step-preview preview-chat">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', width: '85%' }}>
                      <div style={{ alignSelf: 'flex-end', background: 'var(--teal)', color: 'white', padding: '4px 8px', borderRadius: '8px 8px 0 8px', fontSize: '9px', fontWeight: 600 }}>Did the vehicle stop?</div>
                      <div style={{ alignSelf: 'flex-start', background: 'white', border: '1px solid var(--border-color)', color: 'var(--text-primary)', padding: '4px 8px', borderRadius: '8px 8px 8px 0', fontSize: '9px', fontWeight: 600 }}>No, the car jumped the red light...</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="features-section">
              <div className="feature-box">
                <div className="feature-icon-title">
                  <div className="feature-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
                  </div>
                  <h3 className="feature-title">Live Video Monitor Mode</h3>
                </div>
                <div className="feature-list">
                  <div className="feature-item">
                    <span className="feature-bullet">✔</span>
                    <span><strong>Signal Jumping:</strong> Checks for traffic lights and flags any vehicle crossing the boundary during a red signal.</span>
                  </div>
                  <div className="feature-item">
                    <span className="feature-bullet">✔</span>
                    <span><strong>Triple Riding:</strong> Detects motorcycles carrying more than two passengers to prevent safety violations.</span>
                  </div>
                  <div className="feature-item">
                    <span className="feature-bullet">✔</span>
                    <span><strong>Evidence Recording:</strong> Automatically cuts 10-second video clips immediately when a violation is flagged.</span>
                  </div>
                </div>
              </div>

              <div className="feature-box">
                <div className="feature-icon-title">
                  <div className="feature-icon">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                  </div>
                  <h3 className="feature-title">VideoDB AI Verification</h3>
                </div>
                <div className="feature-list">
                  <div className="feature-item">
                    <span className="feature-bullet">✔</span>
                    <span><strong>Scene Shot Indexing:</strong> Videos are indexed into distinct scene shots using VideoDB APIs.</span>
                  </div>
                  <div className="feature-item">
                    <span className="feature-bullet">✔</span>
                    <span><strong>Double-Check LLM:</strong> Generates text descriptions of visual events and queries LLMs to confirm or reject YOLO alerts.</span>
                  </div>
                  <div className="feature-item">
                    <span className="feature-bullet">✔</span>
                    <span><strong>Interactive Q&A:</strong> Ask anything about the incident: license plate details, car model/color, helmet status, etc.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

        <div className="live-container" style={{ display: activeTab === 'live' ? 'grid' : 'none' }}>
            <div className="live-left">
              {uploadedVideoUrl ? (
                <div className="uploaded-video-banner">
                  <div className="banner-info">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M23 7 16 12 23 17 23 7"></path><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect></svg>
                    <span><strong>Test Video Loaded:</strong> {uploadedVideoName || "Custom Video"}</span>
                  </div>
                  <button className="banner-clear-btn" onClick={() => {
                    setUploadedVideoUrl(null);
                    setUploadedVideoName(null);
                    setRawVideoFile(null);
                    if (isMonitoringSignalRef.current) toggleSignalMonitoring();
                    if (isMonitoringTripleRef.current) toggleTripleMonitoring();
                  }}>
                    Switch to Live Camera
                  </button>
                </div>
              ) : (
                <div 
                  className="uploaded-video-banner" 
                  style={{ background: 'rgba(0, 240, 255, 0.04)', border: '1.5px dashed rgba(0, 240, 255, 0.25)', cursor: 'pointer' }}
                  onClick={() => scanningFileInputRef.current.click()}
                >
                  <div className="banner-info" style={{ color: 'var(--teal)' }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                    <span><strong>Upload Video:</strong> Click to load a custom traffic video for AI rule scanning</span>
                  </div>
                </div>
              )}

              <input 
                type="file" 
                accept="video/*" 
                style={{ display: 'none' }} 
                ref={scanningFileInputRef}
                onChange={handleFileSelectForScanning} 
              />

              <div className="video-card">
                <video
                  ref={videoRef}
                  autoPlay={false}
                  playsInline
                  muted
                  onEnded={() => {
                    console.log("[Video] Video playback finished. Stopping monitoring loops...");
                    if (isMonitoringSignalRef.current) toggleSignalMonitoring();
                    if (isMonitoringTripleRef.current) toggleTripleMonitoring();
                  }}
                  style={{ 
                    transform: (facingMode === "user" && !uploadedVideoUrl) ? 'scaleX(-1)' : 'none',
                    pointerEvents: 'none'
                  }}
                />
                <canvas ref={canvasRef} style={{ display: 'none' }} />
                <canvas
                  ref={overlayCanvasRef}
                  className="overlay-canvas"
                  style={{ transform: (facingMode === "user" && !uploadedVideoUrl) ? 'scaleX(-1)' : 'none' }}
                />

                {isMonitoringSignal && (
                  <div className="light-indicator">
                    {lightState.toUpperCase()} SIGNAL
                  </div>
                )}

                {(isMonitoringSignal || isMonitoringTriple) && (
                  <div className="stats-overlay">
                    FPS {fps}
                  </div>
                )}

                {isViolationFound && (
                  <div className="violation-alert">
                    Recording Evidence...
                  </div>
                )}
              </div>

              <div className="action-buttons" style={{ marginTop: '20px' }}>
                {uploadedVideoUrl ? (
                  <div className="automated-scan-status" style={{
                    textAlign: 'center',
                    padding: '12px',
                    borderRadius: '8px',
                    background: 'rgba(0, 240, 255, 0.05)',
                    border: '1.5px solid rgba(0, 240, 255, 0.15)',
                    color: 'var(--teal)',
                    fontWeight: '600',
                    letterSpacing: '0.5px'
                  }}>
                    🤖 Automated AI Rule Scanning Active...
                  </div>
                ) : (
                  <div className="action-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                    <button
                      className={`card-btn ${isMonitoringSignal ? 'active' : ''}`}
                      onClick={toggleSignalMonitoring}
                      style={{ 
                        background: isMonitoringSignal ? 'rgba(255, 75, 75, 0.15)' : 'rgba(255,255,255,0.03)',
                        borderColor: isMonitoringSignal ? '#ff4b4b' : 'rgba(255,255,255,0.1)',
                        color: isMonitoringSignal ? '#ff4b4b' : 'rgba(255,255,255,0.6)',
                        fontWeight: '600',
                        padding: '12px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        borderWidth: '1.5px',
                        borderStyle: 'solid'
                      }}
                    >
                      {isMonitoringSignal ? '🛑 Stop Signal Scan' : '🚦 Start Signal Scan'}
                    </button>
                    <button
                      className={`card-btn ${isMonitoringTriple ? 'active' : ''}`}
                      onClick={toggleTripleMonitoring}
                      style={{ 
                        background: isMonitoringTriple ? 'rgba(255, 75, 75, 0.15)' : 'rgba(255,255,255,0.03)',
                        borderColor: isMonitoringTriple ? '#ff4b4b' : 'rgba(255,255,255,0.1)',
                        color: isMonitoringTriple ? '#ff4b4b' : 'rgba(255,255,255,0.6)',
                        fontWeight: '600',
                        padding: '12px',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        borderWidth: '1.5px',
                        borderStyle: 'solid'
                      }}
                    >
                      {isMonitoringTriple ? '🛑 Stop Triple Scan' : '🏍️ Start Triple Scan'}
                    </button>
                  </div>
                )}
              </div>

            </div>

            <div className="chatbot-section">
              <div className="chat-header">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                VideoDB AI Assistant
              </div>
              <div className="chat-messages">
                {chatMessages.map((msg, idx) => (
                  <div key={idx} className={`message ${msg.sender}`}>
                    {msg.text}
                  </div>
                ))}
                {isUploading && (
                  <div className="message bot" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ display: 'inline-block', width: '8px', height: '8px', background: 'var(--teal)', borderRadius: '50%', animation: 'pulse-detect 1s infinite' }}></span> Analyzing...
                  </div>
                )}
              </div>
              <div className="chat-input-area">
                <input 
                  type="file" 
                  accept="video/*,image/*" 
                  style={{ display: 'none' }} 
                  ref={fileInputRef}
                  onChange={handleFileUpload} 
                />
                <button 
                  className="upload-btn" 
                  onClick={() => fileInputRef.current.click()}
                  disabled={isUploading}
                  style={{ opacity: isUploading ? 0.7 : 1 }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
                  Upload Violation Video
                </button>
              </div>
            </div>
          </div>

        <div className="history-container" style={{ display: activeTab === 'history' ? 'flex' : 'none' }}>
            <div className="controls-bar">
              <div className="dropdown-style">
                <span>Show latest first</span>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
              </div>
              <button className="filter-btn" onClick={clearViolations} title="Clear All">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
              </button>
            </div>

            <div className="card-grid">
              {violations.length === 0 ? (
                <div className="empty-state">No violations recorded yet.</div>
              ) : (
                violations.map((v, idx) => {
                  const isVideo = (v.video_path && v.video_path.endsWith('.webm')) || (v.video_path && v.video_path.endsWith('.mp4'));
                  const mediaUrl = v.video_path ? `${BACKEND_URL}/violations/${v.video_path.split('/').pop()}` : null;
                  
                  let dateStr = v.timestamp;
                  try {
                    dateStr = new Date(v.timestamp).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).toLowerCase();
                  } catch(e){}

                  return (
                    <div key={v.id || idx} className="result-card">
                      <div className="result-card-header">
                        <div className="result-logo">
                          <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline></svg>
                          <span>{v.type}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          <div className="status-badge" data-status={v.status}>{v.status}</div>
                          <button className="info-btn" onClick={() => deleteViolation(v.id)} title="Delete Record">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                          </button>
                        </div>
                      </div>

                      {v.videodb_url ? (
                        <iframe src={v.videodb_url} className="media-preview" title="VideoDB Stream" frameBorder="0" allowFullScreen></iframe>
                      ) : isVideo && mediaUrl ? (
                        <video src={mediaUrl} className="media-preview" controls></video>
                      ) : mediaUrl ? (
                        <img src={mediaUrl} alt="Violation" className="media-preview" />
                      ) : (
                        <div className="media-preview" style={{display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-secondary)'}}>
                          No media available
                        </div>
                      )}

                      <div className="result-card-body">
                        <div>
                          <div className="result-title">
                            {v.location || 'Camera 1'}
                            {idx === 0 && <span className="new-badge">New</span>}
                          </div>
                          <div className="result-date">{dateStr}</div>
                        </div>
                      </div>
                      
                      {v.ai_analysis && v.status === 'Pending' && (
                        <div style={{fontSize: '13px', color: 'var(--text-secondary)'}}>
                          <em>Progress: {v.ai_analysis}</em>
                        </div>
                      )}

                      <div className="action-row">
                        <button className="card-btn" onClick={() => window.open(v.videodb_url || mediaUrl, '_blank')}>View Full</button>
                        {v.videodb_id && (
                          <button className="card-btn" style={{background: 'var(--blue)', color: 'white'}} onClick={() => {
                            setVideoChats(prev => ({...prev, [v.videodb_id]: prev[v.videodb_id] || [{sender: 'bot', text: 'Ask me anything about this video!'}]}));
                          }}>
                            Chat with AI
                          </button>
                        )}
                      </div>
                      
                      {v.videodb_id && videoChats[v.videodb_id] && (
                        <div className="video-chat-section">
                          <div className="chat-messages" style={{height: '200px'}}>
                            {videoChats[v.videodb_id].map((msg, i) => (
                              <div key={i} className={`message ${msg.sender}`}>{msg.text}</div>
                            ))}
                            {isVideoChatting[v.videodb_id] && <div className="message bot">Thinking...</div>}
                          </div>
                          <div className="chat-input-area">
                            <input 
                              type="text" 
                              style={{flex: 1, padding: '8px', border: '1.5px solid var(--border-color)', borderRadius: 'var(--radius-md)'}}
                              value={chatInputs[v.videodb_id] || ''} 
                              onChange={(e) => setChatInputs(prev => ({...prev, [v.videodb_id]: e.target.value}))} 
                              placeholder="Ask about this clip..."
                              onKeyDown={(e) => e.key === 'Enter' && handleVideoChat(v.videodb_id)}
                            />
                            <button onClick={() => handleVideoChat(v.videodb_id)} className="upload-btn" style={{flex: 'none', width: 'auto'}}>Send</button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </main>
    </div>
  );
};

export default App;
