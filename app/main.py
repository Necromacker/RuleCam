from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import videodb
from dotenv import load_dotenv
import os
from typing import List, Optional

# Load env from the python directory
load_dotenv("../python/.env")

app = FastAPI()

# Connect to VideoDB
try:
    conn = videodb.connect()
    coll = conn.get_collection()
except Exception as e:
    print(f"Error connecting to VideoDB: {e}")

class VideoUpload(BaseModel):
    url: str

class SearchQuery(BaseModel):
    query: str

@app.get("/api/videos")
async def get_videos():
    try:
        videos = coll.get_videos()
        return [{"id": v.id, "name": v.name, "stream_url": v.stream_url} for v in videos]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/upload")
async def upload_video(data: VideoUpload):
    try:
        video = coll.upload(url=data.url)
        return {"id": video.id, "name": video.name, "stream_url": video.stream_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/videos/{video_id}/search")
async def search_video(video_id: str, data: SearchQuery):
    from videodb.exceptions import InvalidRequestError
    import re
    from videodb import SearchType, IndexType, SceneExtractionType
    
    try:
        video = coll.get_video(video_id)
        
        # Try spoken word search first
        try:
            video.index_spoken_words(force=True)
            results = video.search(data.query)
            shots = results.get_shots()
            if shots:
                return {
                    "shots": [{"start": s.start, "end": s.end, "text": s.text} for s in shots],
                    "stream_url": results.compile()
                }
        except InvalidRequestError as e:
            if "No results found" not in str(e):
                raise

        # If no spoken results, try scene search (semantic)
        try:
            try:
                scene_index_id = video.index_scenes(
                    extraction_type=SceneExtractionType.shot_based,
                    prompt="Describe the visual content in this scene.",
                )
            except Exception as e:
                match = re.search(r"id\s+([a-f0-9]+)", str(e))
                if match:
                    scene_index_id = match.group(1)
                else:
                    raise

            results = video.search(
                query=data.query,
                search_type=SearchType.semantic,
                index_type=IndexType.scene,
                scene_index_id=scene_index_id,
                score_threshold=0.2
            )
            shots = results.get_shots()
            return {
                "shots": [{"start": s.start, "end": s.end, "text": s.text} for s in shots],
                "stream_url": results.compile()
            }
        except InvalidRequestError as e:
            if "No results found" in str(e):
                return {"shots": [], "stream_url": None}
            raise

    except Exception as e:
        print(f"Search error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/videos/{video_id}/subtitles")
async def add_subtitles(video_id: str):
    try:
        video = coll.get_video(video_id)
        video.index_spoken_words(force=True)
        stream_url = video.add_subtitle()
        return {"stream_url": stream_url}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/generate/video")
async def generate_video(data: SearchQuery): # Reuse SearchQuery for prompt
    try:
        video = coll.generate_video(prompt=data.query, duration=5)
        return {"id": video.id, "name": video.name, "stream_url": video.stream_url}
    except Exception as e:
        print(f"Video gen error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/generate/image")
async def generate_image(data: SearchQuery):
    try:
        image = coll.generate_image(prompt=data.query, aspect_ratio="16:9")
        return {"id": image.id, "url": image.generate_url()}
    except Exception as e:
        print(f"Image gen error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class BrandFetch(BaseModel):
    query: str

@app.post("/api/brand/fetch")
async def fetch_brand_media(data: BrandFetch):
    from serpapi import GoogleSearch
    api_key = os.getenv("SERP_API_KEY")
    
    try:
        search = GoogleSearch({
            "q": data.query,
            "engine": "google_maps",
            "type": "search",
            "api_key": api_key
        })
        results = search.get_dict()
        
        place = results.get("place_results") or results.get("local_results", [{}])[0]
        if not place:
            raise HTTPException(status_code=404, detail="Brand not found on Google Maps")
            
        data_id = place.get("data_id")
        
        photo_search = GoogleSearch({
            "engine": "google_maps_photos",
            "data_id": data_id,
            "api_key": api_key
        })
        photo_results = photo_search.get_dict()
        photos = photo_results.get("photos", [])
        
        # Distinguish between photos and potential video clips
        media = []
        for p in photos[:15]:
            url = p.get("image")
            if url:
                # Some "photos" on Gmaps are actually short video clips
                is_video = "video" in p.get("thumbnail", "").lower() or "video" in p.get("title", "").lower()
                media.append({"url": url, "is_video": is_video})
        
        return {
            "brand_name": place.get("title"),
            "media": media
        }
    except Exception as e:
        print(f"SerpApi error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

class BrandReelRequest(BaseModel):
    brand_name: str
    media_urls: List[str]
    sample_url: Optional[str] = None

@app.post("/api/generate/brand-reel")
async def generate_brand_reel(data: BrandReelRequest):
    from videodb.editor import Timeline, Track, Clip, VideoAsset, AudioAsset, ImageAsset
    try:
        timeline = Timeline(conn)
        timeline.resolution = "1280x720"
        
        video_track = Track()
        
        # 1. Arrange brand assets
        current_time = 0
        for url in data.media_urls[:5]:
            asset_video = coll.upload(url=url)
            # Use as Image if short, or Clip if video
            video_track.add_clip(current_time, Clip(asset=ImageAsset(id=asset_video.id), duration=2.0))
            current_time += 2.0
            
        timeline.add_track(video_track)
        
        # 2. Extract style/audio from Sample YouTube Reel
        if data.sample_url:
            sample_video = coll.upload(url=data.sample_url)
            audio_track = Track()
            # Extract first 10s of audio from the sample
            audio_track.add_clip(0, Clip(asset=AudioAsset(id=sample_video.id), duration=current_time))
            timeline.add_track(audio_track)
        else:
            # Fallback to AI generated music
            music = coll.generate_music(prompt=f"professional upbeat music for {data.brand_name}", duration=current_time)
            audio_track = Track()
            audio_track.add_clip(0, Clip(asset=AudioAsset(id=music.id), duration=current_time))
            timeline.add_track(audio_track)
        
        # 3. Generate stream
        stream_url = timeline.generate_stream()
        
        return {
            "id": f"reel-{data.brand_name}",
            "name": f"Remixed Reel: {data.brand_name}",
            "stream_url": stream_url
        }
    except Exception as e:
        print(f"Brand Reel error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

app.mount("/", StaticFiles(directory="static", html=True), name="static")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
