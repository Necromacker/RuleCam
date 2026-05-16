from fastapi import FastAPI, UploadFile, File, Form
import cv2
import numpy as np
from ultralytics import YOLO
import os
import shutil
import base64
from datetime import datetime

app = FastAPI(title="RuleCam YOLO Inference API")

# Initialize model on startup
print("Loading YOLOv8n model...")
model = YOLO("yolov8n.pt")
print("Model loaded.")

def clip_video_opencv(file_path, start_sec, duration, out_path):
    cap = cv2.VideoCapture(file_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0: fps = 30
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    out = cv2.VideoWriter(out_path, fourcc, fps, (w, h))
    
    cap.set(cv2.CAP_PROP_POS_MSEC, start_sec * 1000)
    frames_needed = int(fps * duration)
    written = 0
    
    while written < frames_needed:
        ret, frame = cap.read()
        if not ret: break
        out.write(frame)
        written += 1
    
    cap.release()
    out.release()
    return written > 0

def yolo_extract_violation_clip(file_path, v_type):
    cap = cv2.VideoCapture(file_path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    if fps <= 0: fps = 30
    
    violation_clips = []
    violation_times = []
    frame_count = 0
    
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    if total_frames <= 0: total_frames = int(fps * 600)
    
    scan_limit = total_frames
    step = max(1, int(fps * 5))
    
    while frame_count < scan_limit:
        ret, frame = cap.read()
        if not ret: break
        
        if frame_count % step == 0:
            current_time = frame_count / fps
            
            if any(abs(current_time - t) < 15 for t in violation_times):
                frame_count += 1
                continue
            
            results = model(frame, imgsz=320, verbose=False)
            h, w = frame.shape[:2]

            v_found = False
            persons = []
            motorcycles = []
            for r in results:
                for box in r.boxes:
                    cls_name = model.names[int(box.cls[0])]
                    if cls_name == "person":
                        persons.append(box.xyxy[0].tolist())
                    elif cls_name == "motorcycle":
                        motorcycles.append({"box": box.xyxy[0].tolist(), "count": 0})
            
            for p in persons:
                px1, py1, px2, py2 = p
                p_area = (px2 - px1) * (py2 - py1)
                if p_area <= 0: continue
                for i, m in enumerate(motorcycles):
                    bx1, by1, bx2, by2 = m["box"]
                    ix1, iy1 = max(px1, bx1), max(py1, by1)
                    ix2, iy2 = min(px2, bx2), min(py2, by2)
                    if ix1 < ix2 and iy1 < iy2:
                        if ((ix2 - ix1) * (iy2 - iy1)) / p_area > 0.4:
                            motorcycles[i]["count"] += 1
            
            if any(m["count"] >= 3 for m in motorcycles):
                v_found = True
            
            if not v_found:
                light_state = "unknown"
                light_y = 0.8
                for r in results:
                    for box in r.boxes:
                        if model.names[int(box.cls[0])] == "traffic light":
                            lx1, ly1, lx2, ly2 = map(int, box.xyxy[0].tolist())
                            light_y = ly2 / h
                            if ly2 > ly1 and lx2 > lx1:
                                crop = frame[ly1:ly2, lx1:lx2]
                                hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
                                r_m = cv2.inRange(hsv, np.array([0, 70, 50]), np.array([10, 255, 255]))
                                if np.sum(r_m) > 500: light_state = "red"
                
                if light_state == "red":
                    for r in results:
                        for box in r.boxes:
                            if model.names[int(box.cls[0])] in ["car", "motorcycle"]:
                                if (box.xyxy[0][3] / h) > light_y:
                                    v_found = True
            
            if v_found:
                violation_times.append(current_time)
                start_clip = max(0, current_time - 5)
                out_filename = f"clip_{len(violation_times)}.mp4"
                cap.release()
                clip_video_opencv(file_path, start_clip, 10, out_filename)
                if os.path.exists(out_filename):
                    violation_clips.append(out_filename)
                cap = cv2.VideoCapture(file_path)
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_count)

        frame_count += 1
        
    cap.release()
    
    if not violation_clips:
        fallback_name = "fallback.mp4"
        if clip_video_opencv(file_path, 0, 10, fallback_name):
            violation_clips.append(fallback_name)
    
    return violation_clips

@app.post("/analyze")
async def analyze(video: UploadFile = File(...), v_type: str = Form("General Violation")):
    temp_path = f"temp_{video.filename}"
    with open(temp_path, "wb") as buffer:
        shutil.copyfileobj(video.file, buffer)
        
    clips = yolo_extract_violation_clip(temp_path, v_type)
    
    encoded_clips = []
    for clip_path in clips:
        with open(clip_path, "rb") as f:
            encoded_clips.append(base64.b64encode(f.read()).decode('utf-8'))
        os.remove(clip_path)
        
    os.remove(temp_path)
    return {"status": "success", "clips": encoded_clips}

@app.get("/")
def root():
    return {"message": "RuleCam YOLO Inference API is running."}
