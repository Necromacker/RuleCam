from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import sqlite3
import os
from datetime import datetime
import threading
import time
from dotenv import load_dotenv
import base64

load_dotenv()

# Initialize local YOLOv8 model if available (DO NOT load on Render to prevent memory/OOM crashes!)
local_yolo = None
if not os.getenv("RENDER"):
    try:
        from ultralytics import YOLO
        import cv2
        import numpy as np
        local_yolo = YOLO("yolov8n.pt")
        print("Local YOLOv8 model loaded successfully.")
    except Exception as e:
        print(f"Could not load local YOLOv8 model: {e}")
else:
    print("Running in Cloud/Render environment. Local YOLO is completely disabled to avoid RAM OOM crashes.")


app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

import logging
log = logging.getLogger('werkzeug')
log.setLevel(logging.ERROR)

videodb_lock = threading.Lock()
light_state_history = []
HISTORY_SIZE = 5
VIOLATIONS_DIR = "violations"
DB_PATH = "database.db"
VIDEODB_API_KEY = os.getenv("VIDEODB_API_KEY", "")
if not os.path.exists(VIOLATIONS_DIR):
    os.makedirs(VIOLATIONS_DIR)

@app.route('/violations/<filename>')
def serve_violation(filename):
    return send_from_directory(VIOLATIONS_DIR, filename)

@app.route("/", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": "yolov8n"})

@app.route("/detect_signal", methods=["POST"])
def detect_signal():
    try:
        data = request.json
        
        # Determine if we should bypass local YOLO and run the Hugging Face Space API call directly
        # Bypassed on Render or if local model didn't load or if HF_API_URL is explicitly configured
        run_local = (local_yolo is not None) and (not os.getenv("RENDER")) and (not os.getenv("HF_API_URL"))
        
        if run_local:
            # Local YOLOv8 detection logic
            img_data = data.get("image", "")
            if img_data.startswith("data:image"):
                img_data = img_data.split(",")[1]
                
            img_bytes = base64.b64decode(img_data)
            np_arr = np.frombuffer(img_bytes, np.uint8)
            frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            if frame is None:
                return jsonify({"error": "Failed to decode image"}), 400
            h, w = frame.shape[:2]
            
            results = local_yolo(frame, imgsz=320, verbose=False)
            
            detections = []
            light_state = "unknown"
            light_y = 0.8
            
            for r in results:
                for box in r.boxes:
                    cls_name = local_yolo.names[int(box.cls[0])]
                    bx1, by1, bx2, by2 = map(int, box.xyxy[0].tolist())
                    conf = float(box.conf[0])
                    
                    if cls_name == "traffic light":
                        light_y = by2 / h
                        if by2 > by1 and bx2 > bx1:
                            crop = frame[by1:by2, bx1:bx2]
                            hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
                            r_m = cv2.inRange(hsv, np.array([0, 70, 50]), np.array([10, 255, 255]))
                            y_m = cv2.inRange(hsv, np.array([15, 150, 150]), np.array([35, 255, 255]))
                            g_m = cv2.inRange(hsv, np.array([40, 50, 50]), np.array([90, 255, 255]))
                            r_sum, y_sum, g_sum = np.sum(r_m), np.sum(y_m), np.sum(g_m)
                            if r_sum > 500 and r_sum > y_sum and r_sum > g_sum:
                                light_state = "red"
                            elif y_sum > 200 and y_sum > r_sum and y_sum > g_sum:
                                light_state = "yellow"
                            elif g_sum > 500 and g_sum > r_sum and g_sum > y_sum:
                                light_state = "green"
                                
                    detections.append({
                        "object": cls_name,
                        "confidence": conf,
                        "bbox": [bx1, by1, bx2, by2],
                        "is_violating": False
                    })
            
            v_found = False
            if light_state == "red":
                for d in detections:
                    if d["object"] in ["car", "motorcycle", "bus", "truck"]:
                        if (d["bbox"][3] / h) > light_y:
                            d["is_violating"] = True
                            v_found = True
                            
            return jsonify({
                "detections": detections,
                "violation_detected": v_found,
                "traffic_light_state": light_state,
                "image_shape": [h, w]
            })
            
        else:
            # Bypassed local YOLO! Proxies API request directly to Hugging Face Space
            hf_api_url = os.getenv("HF_API_URL", "https://necromacker-rulecam.hf.space/analyze")
            import requests
            hf_base = hf_api_url.rstrip('/').removesuffix('/analyze')
            resp = requests.post(f"{hf_base}/detect_signal", json={"image": data.get("image", "")})
            if resp.status_code == 200:
                return jsonify(resp.json())
            else:
                return jsonify({"error": f"HF API Error: {resp.status_code}"}), 500
    except Exception as e:
        print("Error in detect_signal:", e)
        return jsonify({"error": str(e)}), 500

@app.route("/detect_triple", methods=["POST"])
def detect_triple():
    try:
        data = request.json
        
        # Determine if we should bypass local YOLO and run the Hugging Face Space API call directly
        # Bypassed on Render or if local model didn't load or if HF_API_URL is explicitly configured
        run_local = (local_yolo is not None) and (not os.getenv("RENDER")) and (not os.getenv("HF_API_URL"))
        
        if run_local:
            # Local YOLOv8 detection logic
            img_data = data.get("image", "")
            if img_data.startswith("data:image"):
                img_data = img_data.split(",")[1]
                
            img_bytes = base64.b64decode(img_data)
            np_arr = np.frombuffer(img_bytes, np.uint8)
            frame = cv2.imdecode(np_arr, cv2.IMREAD_COLOR)
            if frame is None:
                return jsonify({"error": "Failed to decode image"}), 400
            h, w = frame.shape[:2]
            
            results = local_yolo(frame, imgsz=320, verbose=False)
            
            detections = []
            persons = []
            motorcycles = []
            
            for r in results:
                for box in r.boxes:
                    cls_name = local_yolo.names[int(box.cls[0])]
                    bx1, by1, bx2, by2 = map(int, box.xyxy[0].tolist())
                    conf = float(box.conf[0])
                    
                    det = {
                        "object": cls_name,
                        "confidence": conf,
                        "bbox": [bx1, by1, bx2, by2],
                        "is_violating": False
                    }
                    detections.append(det)
                    
                    if cls_name == "person":
                        persons.append(det)
                    elif cls_name == "motorcycle":
                        motorcycles.append({"det": det, "count": 0})
                        
            v_found = False
            for p in persons:
                px1, py1, px2, py2 = p["bbox"]
                p_area = (px2 - px1) * (py2 - py1)
                if p_area <= 0: continue
                for i, m in enumerate(motorcycles):
                    bx1, by1, bx2, by2 = m["det"]["bbox"]
                    ix1, iy1 = max(px1, bx1), max(py1, by1)
                    ix2, iy2 = min(px2, bx2), min(py2, by2)
                    if ix1 < ix2 and iy1 < iy2:
                        if ((ix2 - ix1) * (iy2 - iy1)) / p_area > 0.4:
                            motorcycles[i]["count"] += 1
                            
            for m in motorcycles:
                if m["count"] >= 3:
                    m["det"]["is_violating"] = True
                    v_found = True
                    
            return jsonify({
                "detections": detections,
                "violation_detected": v_found,
                "image_shape": [h, w]
            })
            
        else:
            # Bypassed local YOLO! Proxies API request directly to Hugging Face Space
            hf_api_url = os.getenv("HF_API_URL", "https://necromacker-rulecam.hf.space/analyze")
            import requests
            hf_base = hf_api_url.rstrip('/').removesuffix('/analyze')
            resp = requests.post(f"{hf_base}/detect_triple", json={"image": data.get("image", "")})
            if resp.status_code == 200:
                return jsonify(resp.json())
            else:
                return jsonify({"error": f"HF API Error: {resp.status_code}"}), 500
    except Exception as e:
        print("Error in detect_triple:", e)
        return jsonify({"error": str(e)}), 500


@app.route("/scan_uploaded_video", methods=["POST"])
def scan_uploaded_video():
    if "video" not in request.files:
        return jsonify({"error": "No video file provided"}), 400
        
    video_file = request.files["video"]
    v_type = request.form.get("type", "signal") # 'signal' or 'triple'
    
    # Save temp video file
    temp_filename = f"temp_scan_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4"
    temp_path = os.path.join(VIOLATIONS_DIR, temp_filename)
    video_file.save(temp_path)
    
    # Check if we should run local YOLO or call Hugging Face
    run_local = (local_yolo is not None) and (not os.getenv("RENDER")) and (not os.getenv("HF_API_URL"))
    
    try:
        if run_local:
            import cv2
            import numpy as np
            # Run local YOLO scan on the video
            cap = cv2.VideoCapture(temp_path)
            fps = cap.get(cv2.CAP_PROP_FPS)
            if fps <= 0: fps = 30
            
            sample_rate = max(1, int(fps / 5)) # 5 FPS
            frames_data = []
            frame_count = 0
            
            while True:
                ret, frame = cap.read()
                if not ret: break
                
                if frame_count % sample_rate == 0:
                    h, w = frame.shape[:2]
                    results = local_yolo(frame, imgsz=320, verbose=False)
                    
                    detections = []
                    light_state = "unknown"
                    light_y = 0.8
                    persons = []
                    motorcycles = []
                    
                    for r in results:
                        for box in r.boxes:
                            cls_name = local_yolo.names[int(box.cls[0])]
                            bx1, by1, bx2, by2 = map(int, box.xyxy[0].tolist())
                            conf = float(box.conf[0])
                            
                            if cls_name == "traffic light":
                                light_y = by2 / h
                                if by2 > by1 and bx2 > bx1:
                                    crop = frame[by1:by2, bx1:bx2]
                                    hsv = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
                                    r_m = cv2.inRange(hsv, np.array([0, 70, 50]), np.array([10, 255, 255]))
                                    y_m = cv2.inRange(hsv, np.array([15, 150, 150]), np.array([35, 255, 255]))
                                    g_m = cv2.inRange(hsv, np.array([40, 50, 50]), np.array([90, 255, 255]))
                                    r_sum, y_sum, g_sum = np.sum(r_m), np.sum(y_m), np.sum(g_m)
                                    if r_sum > 500 and r_sum > y_sum and r_sum > g_sum:
                                        light_state = "red"
                                    elif y_sum > 200 and y_sum > r_sum and y_sum > g_sum:
                                        light_state = "yellow"
                                    elif g_sum > 500 and g_sum > r_sum and g_sum > y_sum:
                                        light_state = "green"
                                        
                            detections.append({
                                "object": cls_name,
                                "confidence": conf,
                                "bbox": [bx1, by1, bx2, by2],
                                "is_violating": False
                            })
                            
                            if cls_name == "person":
                                persons.append(detections[-1])
                            elif cls_name == "motorcycle":
                                motorcycles.append({"det": detections[-1], "count": 0})
                                
                    violation_detected = False
                    if v_type == "signal":
                        if light_state == "red":
                            for d in detections:
                                if d["object"] in ["car", "motorcycle", "bus", "truck"]:
                                    if (d["bbox"][3] / h) > light_y:
                                        d["is_violating"] = True
                                        violation_detected = True
                    elif v_type == "triple":
                        for p in persons:
                            px1, py1, px2, py2 = p["bbox"]
                            p_area = (px2 - px1) * (py2 - py1)
                            if p_area <= 0: continue
                            for i, m in enumerate(motorcycles):
                                bx1, by1, bx2, by2 = m["det"]["bbox"]
                                ix1, iy1 = max(px1, bx1), max(py1, by1)
                                ix2, iy2 = min(px2, bx2), min(py2, by2)
                                if ix1 < ix2 and iy1 < iy2:
                                    if ((ix2 - ix1) * (iy2 - iy1)) / p_area > 0.4:
                                        motorcycles[i]["count"] += 1
                        for m in motorcycles:
                            if m["count"] >= 3:
                                m["det"]["is_violating"] = True
                                violation_detected = True
                                
                    draw_frame = frame.copy()
                    
                    # Light state overlay
                    if v_type == "signal" and light_state != "unknown":
                        colors_map = {"red": (0, 0, 255), "yellow": (0, 255, 255), "green": (0, 255, 0)}
                        color = colors_map.get(light_state, (255, 255, 0))
                        cv2.circle(draw_frame, (30, 30), 10, color, -1)
                        cv2.putText(draw_frame, f"SIGNAL: {light_state.upper()}", (50, 35), cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)
                        
                    for d in detections:
                        bx1, by1, bx2, by2 = d["bbox"]
                        color = (0, 0, 255) if d["is_violating"] else (255, 255, 0)
                        thickness = 3 if d["is_violating"] else 2
                        cv2.rectangle(draw_frame, (bx1, by1), (bx2, by2), color, thickness)
                        label = d["object"]
                        if d["is_violating"]:
                            label += " (VIOLATION)"
                        cv2.putText(draw_frame, label, (bx1, by1 - 5), cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 1)
                        
                    _, buffer_img = cv2.imencode('.jpg', draw_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
                    img_base64 = base64.b64encode(buffer_img).decode('utf-8')
                    
                    frames_data.append({
                        "image": f"data:image/jpeg;base64,{img_base64}",
                        "violation_detected": violation_detected,
                        "traffic_light_state": light_state if v_type == "signal" else "N/A"
                    })
                    
                frame_count += 1
                
            cap.release()
            if os.path.exists(temp_path):
                os.remove(temp_path)
                
            return jsonify({"status": "success", "frames": frames_data})
            
        else:
            # Proxy to Hugging Face
            hf_api_url = os.getenv("HF_API_URL", "https://necromacker-rulecam.hf.space/analyze")
            hf_base = hf_api_url.rstrip('/').removesuffix('/analyze')
            
            import requests
            # Send video file to Hugging Face space /scan_video endpoint!
            with open(temp_path, 'rb') as f:
                resp = requests.post(f"{hf_base}/scan_video", files={"video": f}, data={"type": v_type})
                
            if os.path.exists(temp_path):
                os.remove(temp_path)
                
            if resp.status_code == 200:
                return jsonify(resp.json())
                
            return jsonify({"error": f"HF Space scan error: {resp.status_code}"}), 500
            
    except Exception as e:
        if os.path.exists(temp_path):
            os.remove(temp_path)
        print("Error in scan_uploaded_video:", e)
        return jsonify({"error": str(e)}), 500


def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS violations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            timestamp TEXT NOT NULL,
            type TEXT NOT NULL,
            video_path TEXT,
            vehicle_type TEXT,
            status TEXT,
            videodb_url TEXT,
            ai_analysis TEXT,
            videodb_id TEXT
        )
    ''')
    conn.commit()
    conn.close()

init_db()

def update_progress(record_id, text):
    try:
        conn_db = sqlite3.connect(DB_PATH)
        cursor = conn_db.cursor()
        cursor.execute('UPDATE violations SET ai_analysis = ? WHERE id = ?', (text, record_id))
        conn_db.commit()
        conn_db.close()
    except:
        pass

def local_clip_video_opencv(file_path, start_sec, duration, out_path):
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

def local_yolo_extract_violation_clip(file_path, v_type, record_id):
    if local_yolo is None:
        return []
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
            
            results = local_yolo(frame, imgsz=320, verbose=False)
            h, w = frame.shape[:2]

            v_found = False
            persons = []
            motorcycles = []
            for r in results:
                for box in r.boxes:
                    cls_name = local_yolo.names[int(box.cls[0])]
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
                        if local_yolo.names[int(box.cls[0])] == "traffic light":
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
                            if local_yolo.names[int(box.cls[0])] in ["car", "motorcycle"]:
                                if (box.xyxy[0][3] / h) > light_y:
                                    v_found = True
            
            if v_found:
                violation_times.append(current_time)
                start_clip = max(0, current_time - 5)
                out_filename = os.path.join(VIOLATIONS_DIR, f"clip_{record_id}_{len(violation_times)}.mp4")
                cap.release()
                local_clip_video_opencv(file_path, start_clip, 10, out_filename)
                if os.path.exists(out_filename):
                    violation_clips.append(out_filename)
                cap = cv2.VideoCapture(file_path)
                cap.set(cv2.CAP_PROP_POS_FRAMES, frame_count)

        frame_count += 1
        
    cap.release()
    
    if not violation_clips:
        fallback_name = os.path.join(VIOLATIONS_DIR, f"fallback_{record_id}.mp4")
        if local_clip_video_opencv(file_path, 0, 10, fallback_name):
            violation_clips.append(fallback_name)
    
    return violation_clips

def process_videodb_workflow(file_path, record_id):
    if not VIDEODB_API_KEY:
        return
    
    # Small delay to ensure DB commit is finished
    time.sleep(0.5)
    
    conn_db = sqlite3.connect(DB_PATH)
    cursor = conn_db.cursor()
    cursor.execute('SELECT type FROM violations WHERE id = ?', (record_id,))
    row = cursor.fetchone()
    conn_db.close()
    
    if not row:
        print(f"Error: Record {record_id} not found in database.")
        return
    v_type = row[0]

    with videodb_lock:
        try:
            import videodb
            from videodb import SceneExtractionType
            from videodb.editor import Timeline, Track, Clip, VideoAsset
            hf_api_url = os.getenv("HF_API_URL")
            if hf_api_url:
                update_progress(record_id, "Sending video to AI Inference API for YOLO analysis...")
                import requests
                try:
                    with open(file_path, 'rb') as f:
                        resp = requests.post(hf_api_url, files={"video": f}, data={"v_type": v_type})
                    if resp.status_code == 200:
                        encoded_clips = resp.json().get("clips", [])
                        clips = []
                        for idx, enc in enumerate(encoded_clips):
                            out_path = os.path.join(VIOLATIONS_DIR, f"hf_clip_{record_id}_{idx}.mp4")
                            with open(out_path, "wb") as f_out:
                                f_out.write(base64.b64decode(enc))
                            clips.append(out_path)
                    else:
                        update_progress(record_id, f"HF API Error: {resp.status_code}")
                        clips = []
                except Exception as e:
                    update_progress(record_id, f"HF API Connection Error: {e}")
                    clips = []
            else:
                # Local YOLO processing!
                if local_yolo:
                    update_progress(record_id, "Running local YOLO analysis & slicing violation clips...")
                    try:
                        clips = local_yolo_extract_violation_clip(file_path, v_type, record_id)
                    except Exception as e:
                        update_progress(record_id, f"Local YOLO Error: {str(e)}")
                        clips = []
                else:
                    update_progress(record_id, "Error: HF_API_URL not set and local YOLO is unavailable.")
                    clips = []
            
            if not clips:
                update_progress(record_id, "No violations detected by YOLO.")
                return


            conn = videodb.connect(api_key=VIDEODB_API_KEY)
            
            for i, clip_path in enumerate(clips):
                rid = record_id if i == 0 else -1
                if rid == -1:
                    conn_db = sqlite3.connect(DB_PATH)
                    cursor = conn_db.cursor()
                    cursor.execute('INSERT INTO violations (timestamp, type, status) VALUES (?, ?, ?)', 
                                   (datetime.now().strftime("%Y-%m-%d %H:%M:%S"), v_type, "Pending"))
                    rid = cursor.lastrowid
                    conn_db.commit()
                    conn_db.close()

                update_progress(rid, f"Uploading clip {i+1} to VideoDB...")
                video = conn.upload(clip_path)
                
                timeline = Timeline(conn)
                video_asset = VideoAsset(id=video.id, start=0)
                track = Track()
                track.add_clip(0, Clip(asset=video_asset, duration=video.length))
                timeline.add_track(track)
                stream_url = timeline.generate_stream()
                
                update_progress(rid, f"AI analysis for clip {i+1}...")
                video.index_scenes(extraction_type=SceneExtractionType.shot_based)
                
                # Poll for scenes (wait up to 60s)
                scenes = []
                scene_context = ""
                for attempt in range(6):
                    time.sleep(10)
                    try:
                        indexes = video.list_scene_index()
                        if indexes and len(indexes) > 0:
                            idx_id = indexes[0].get('scene_index_id') if isinstance(indexes[0], dict) else indexes[0]
                            scenes = video.get_scene_index(idx_id)
                            if scenes:
                                for j, s in enumerate(scenes[:8]):
                                    desc = s.get('description', '') if isinstance(s, dict) else str(s)
                                    if desc: scene_context += f"Scene {j+1}: {desc}\n"
                                break
                        print(f"[VideoDB] Waiting for indexing (attempt {attempt+1}/6)...")
                    except Exception as e:
                        print(f"[VideoDB] Indexing poll error: {e}")

                status = "Rejected"
                analysis = "No violation confirmed by AI."

                if scene_context:
                    # Use LLM to confirm violation based on scenes (matches chat logic)
                    coll = conn.get_collection()
                    prompt = f"""Analyze these video scenes and determine if there is a traffic violation (specifically looking for: {v_type}). 
SCENES:
{scene_context}

Respond with exactly 'VERDICT: CONFIRMED' if a violation is present, or 'VERDICT: REJECTED' if not. Then provide a one-sentence explanation."""
                    
                    try:
                        llm_res = coll.generate_text(prompt)
                        res_text = llm_res.get('output', str(llm_res)) if isinstance(llm_res, dict) else str(llm_res)
                        
                        if "CONFIRMED" in res_text.upper():
                            status = "Confirmed"
                            analysis = f"AI Confirmed: {res_text.split('CONFIRMED')[-1].strip(': ').strip()}"
                        else:
                            status = "Rejected"
                            analysis = f"AI Rejected: {res_text.split('REJECTED')[-1].strip(': ').strip()}"
                    except Exception as e:
                        print(f"[VideoDB] LLM Analysis error: {e}")
                        # Fallback to basic search if LLM fails
                        try:
                            search_results = video.search("identify traffic violation")
                            if search_results and len(search_results) > 0:
                                status = "Confirmed"
                                analysis = f"Confirmed via search fallback ({len(search_results)} results)."
                        except:
                            pass
                else:
                    # Fallback if scenes never ready
                    analysis = "Rejected: Video scene data never became available for analysis."
                
                conn_db = sqlite3.connect(DB_PATH)
                cursor = conn_db.cursor()
                cursor.execute('UPDATE violations SET videodb_url=?, video_path=?, videodb_id=?, status=?, ai_analysis=? WHERE id=?', 
                               (stream_url, os.path.basename(clip_path), video.id, status, analysis, rid))
                conn_db.commit()
                conn_db.close()

            if os.path.exists(file_path):
                os.remove(file_path)
                
        except Exception as e:
            import traceback
            traceback.print_exc()
            update_progress(record_id, f"Error: {str(e)}")

@app.route("/report_violation", methods=["POST"])
def report_violation():
    if "media" not in request.files:
        return jsonify({"error": "No media file provided"}), 400

    file = request.files["media"]
    v_type = request.form.get("type", "General Violation")
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    filename = f"violation_{datetime.now().strftime('%Y%m%d_%H%M%S')}.mp4"
    filepath = os.path.join(VIOLATIONS_DIR, filename)
    file.save(filepath)

    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('INSERT INTO violations (timestamp, type, video_path, status) VALUES (?, ?, ?, ?)', 
                       (timestamp, v_type, filename, "Pending"))
        record_id = cursor.lastrowid
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"DB Error: {e}")
        record_id = -1
        
    threading.Thread(target=process_videodb_workflow, args=(filepath, record_id)).start()
    return jsonify({"status": "success", "id": record_id})

@app.route('/violations', methods=['GET'])
def get_violations():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('SELECT id, timestamp, type, video_path, vehicle_type, status, videodb_url, ai_analysis, videodb_id FROM violations ORDER BY id DESC')
    rows = cursor.fetchall()
    conn.close()
    
    violations = []
    for r in rows:
        violations.append({
            "id": r[0], "timestamp": r[1], "type": r[2], "video_path": r[3], "vehicle_type": r[4], 
            "status": r[5], "videodb_url": r[6], "ai_analysis": r[7], "videodb_id": r[8]
        })
    return jsonify(violations)

@app.route('/chat_with_video', methods=['POST'])
def chat_with_video():
    data = request.json
    video_id = data.get('video_id')
    question = data.get('question')
    if not video_id or not question:
        return jsonify({"error": "Missing video_id or question"}), 400
    try:
        import videodb
        conn = videodb.connect(api_key=VIDEODB_API_KEY)
        coll = conn.get_collection()
        
        try:
            video = coll.get_video(video_id)
        except Exception:
            return jsonify({"answer": "This video is no longer available in VideoDB. It may have expired or been removed."})
        
        # Get scene descriptions
        scene_context = ""
        try:
            indexes = video.list_scene_index()
            if indexes and len(indexes) > 0:
                idx_id = indexes[0].get('scene_index_id') if isinstance(indexes[0], dict) else indexes[0]
                scenes = video.get_scene_index(idx_id)
                if scenes:
                    for i, s in enumerate(scenes[:8]):
                        desc = s.get('description', '') if isinstance(s, dict) else str(s)
                        if desc:
                            scene_context += f"Scene {i+1}: {desc}\n"
        except Exception as e:
            print(f"[Chat] Could not get scenes: {e}")
        
        if not scene_context:
            return jsonify({"answer": "Video scene data is not available yet. Please try again in a moment."})
        
        # Use VideoDB's built-in LLM to answer the question
        prompt = f"""You are a traffic violation analysis AI. Based on the following video scene descriptions, answer the user's question concisely and clearly.

VIDEO SCENES:
{scene_context}

USER QUESTION: {question}

Answer directly and specifically. If the user asks about violations, identify any traffic rules being broken (e.g., triple riding, signal jumping, no helmet, overspeeding). Keep your answer under 200 words."""

        try:
            result = coll.generate_text(prompt)
            if isinstance(result, dict):
                answer = result.get('output', str(result))
            else:
                answer = str(result)
        except Exception as e:
            print(f"[Chat] generate_text error: {e}")
            answer = f"AI could not process your question at this time."
        
        return jsonify({"answer": answer})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/delete_violation/<int:violation_id>", methods=["POST"])
def delete_violation(violation_id):
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('SELECT video_path FROM violations WHERE id = ?', (violation_id,))
        row = cursor.fetchone()
        if row:
            file_path = os.path.join(VIOLATIONS_DIR, row[0])
            if os.path.exists(file_path): os.remove(file_path)
        cursor.execute('DELETE FROM violations WHERE id = ?', (violation_id,))
        conn.commit()
        conn.close()
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/clear_violations", methods=["POST"])
def clear_violations():
    try:
        conn = sqlite3.connect(DB_PATH)
        cursor = conn.cursor()
        cursor.execute('DELETE FROM violations')
        conn.commit()
        conn.close()
        for filename in os.listdir(VIOLATIONS_DIR):
            file_path = os.path.join(VIOLATIONS_DIR, filename)
            if os.path.isfile(file_path): os.unlink(file_path)
        return jsonify({"status": "success"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    print("RuleCam YOLO Backend starting...")
    app.run(host="0.0.0.0", port=5005, debug=False)
