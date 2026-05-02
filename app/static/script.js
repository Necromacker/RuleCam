const uploadBtn = document.getElementById('uploadBtn');
const videoUrlInput = document.getElementById('videoUrl');
const videoList = document.getElementById('videoList');
const refreshBtn = document.getElementById('refreshBtn');
const playerSection = document.getElementById('playerSection');
const videoPlayer = document.getElementById('videoPlayer');
const nowPlayingTitle = document.getElementById('nowPlayingTitle');
const closePlayer = document.getElementById('closePlayer');
const searchBtn = document.getElementById('searchBtn');
const searchQueryInput = document.getElementById('searchQuery');
const searchResults = document.getElementById('searchResults');
const subtitlesBtn = document.getElementById('subtitlesBtn');

let currentVideoId = null;

async function fetchVideos() {
    try {
        const response = await fetch('/api/videos');
        const videos = await response.json();
        renderVideos(videos);
    } catch (error) {
        console.error('Error fetching videos:', error);
    }
}

function renderVideos(videos) {
    videoList.innerHTML = videos.map(video => `
        <div class="video-card">
            <h3>${video.name || 'Untitled Video'}</h3>
            <p style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 12px;">ID: ${video.id}</p>
            <div class="video-actions">
                <button onclick="playVideo('${video.id}', '${video.name}', '${video.stream_url}')">Play</button>
            </div>
        </div>
    `).join('');
}

window.playVideo = function(id, name, streamUrl) {
    currentVideoId = id;
    nowPlayingTitle.innerText = name || 'Now Playing';
    videoPlayer.src = `https://console.videodb.io/player?url=${streamUrl}`;
    playerSection.style.display = 'block';
    playerSection.scrollIntoView({ behavior: 'smooth' });
    searchResults.innerHTML = '';
};

closePlayer.onclick = () => {
    playerSection.style.display = 'none';
    videoPlayer.src = '';
};

uploadBtn.onclick = async () => {
    const url = videoUrlInput.value.trim();
    if (!url) return;

    uploadBtn.innerHTML = '<span class="spinner"></span> Uploading...';
    uploadBtn.classList.add('loading');

    try {
        const response = await fetch('/api/upload', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const video = await response.json();
        videoUrlInput.value = '';
        fetchVideos();
        playVideo(video.id, video.name, video.stream_url);
    } catch (error) {
        console.error('Error uploading:', error);
        alert('Upload failed');
    } finally {
        uploadBtn.innerText = 'Upload';
        uploadBtn.classList.remove('loading');
    }
};

searchBtn.onclick = async () => {
    const query = searchQueryInput.value.trim();
    if (!query || !currentVideoId) return;

    searchBtn.innerHTML = '<span class="spinner"></span> Searching...';
    searchBtn.classList.add('loading');

    try {
        const response = await fetch(`/api/videos/${currentVideoId}/search`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Search failed');
        }

        const data = await response.json();
        
        if (data.stream_url) {
            videoPlayer.src = `https://console.videodb.io/player?url=${data.stream_url}`;
        }

        if (data.shots && data.shots.length > 0) {
            searchResults.innerHTML = data.shots.map(shot => `
                <div class="result-item" onclick="seekTo(${shot.start})">
                    <span style="font-weight: 600; color: var(--primary)">${formatTime(shot.start)}</span>
                    <span style="margin-left: 8px;">${shot.text}</span>
                </div>
            `).join('');
        } else {
            searchResults.innerHTML = '<p style="padding: 10px; color: var(--text-muted);">No results found for this query.</p>';
        }
    } catch (error) {
        console.error('Error searching:', error);
        alert('Search error: ' + error.message);
    } finally {
        searchBtn.innerText = 'Search';
        searchBtn.classList.remove('loading');
    }
};

subtitlesBtn.onclick = async () => {
    if (!currentVideoId) return;

    subtitlesBtn.innerHTML = '<span class="spinner"></span> Processing...';
    subtitlesBtn.classList.add('loading');

    try {
        const response = await fetch(`/api/videos/${currentVideoId}/subtitles`, {
            method: 'POST'
        });
        const data = await response.json();
        videoPlayer.src = `https://console.videodb.io/player?url=${data.stream_url}`;
    } catch (error) {
        console.error('Error adding subtitles:', error);
        alert('Failed to add subtitles');
    } finally {
        subtitlesBtn.innerText = 'Generate Subtitles';
        subtitlesBtn.classList.remove('loading');
    }
};

window.seekTo = function(seconds) {
    const currentUrl = new URL(videoPlayer.src);
    const streamUrl = currentUrl.searchParams.get('url');
    videoPlayer.src = `https://console.videodb.io/player?url=${streamUrl}&time=${seconds}`;
};

function formatTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    return [h, m, s].map(v => v.toString().padStart(2, '0')).join(':');
}

refreshBtn.onclick = fetchVideos;

const genVideoBtn = document.getElementById('genVideoBtn');
const genImageBtn = document.getElementById('genImageBtn');
const genPromptInput = document.getElementById('genPrompt');
const genResults = document.getElementById('genResults');

genVideoBtn.onclick = async () => {
    const query = genPromptInput.value.trim();
    if (!query) return;

    genVideoBtn.innerHTML = '<span class="spinner"></span> Generating...';
    genVideoBtn.classList.add('loading');

    try {
        const response = await fetch('/api/generate/video', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        const video = await response.json();
        if (response.ok) {
            fetchVideos();
            playVideo(video.id, video.name, video.stream_url);
            genPromptInput.value = '';
        } else {
            throw new Error(video.detail || 'Generation failed');
        }
    } catch (error) {
        console.error('Error generating video:', error);
        alert('Generation failed: ' + error.message);
    } finally {
        genVideoBtn.innerText = 'Gen Video';
        genVideoBtn.classList.remove('loading');
    }
};

genImageBtn.onclick = async () => {
    const query = genPromptInput.value.trim();
    if (!query) return;

    genImageBtn.innerHTML = '<span class="spinner"></span> Generating...';
    genImageBtn.classList.add('loading');

    try {
        const response = await fetch('/api/generate/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        const image = await response.json();
        if (response.ok) {
            const imgEl = document.createElement('div');
            imgEl.className = 'video-card';
            imgEl.innerHTML = `
                <img src="${image.url}" style="width: 100%; border-radius: 8px; margin-bottom: 8px;">
                <p style="font-size: 0.8rem; color: var(--text-muted);">Generated Image</p>
                <a href="${image.url}" target="_blank" style="color: var(--primary); font-size: 0.8rem; text-decoration: none;">View Full Size</a>
            `;
            genResults.prepend(imgEl);
            genPromptInput.value = '';
        } else {
            throw new Error(image.detail || 'Generation failed');
        }
    } catch (error) {
        console.error('Error generating image:', error);
        alert('Generation failed: ' + error.message);
    } finally {
        genImageBtn.innerText = 'Gen Image';
        genImageBtn.classList.remove('loading');
    }
};

const fetchMediaBtn = document.getElementById('fetchMediaBtn');
const brandQueryInput = document.getElementById('brandQuery');
const brandReelBtn = document.getElementById('brandReelBtn');
const step1 = document.getElementById('step1');
const step2 = document.getElementById('step2');
const mediaGrid = document.getElementById('mediaGrid');
const foundBrandName = document.getElementById('foundBrandName');
const restartBtn = document.getElementById('restartBtn');

let currentBrandData = null;

const sampleUrlInput = document.getElementById('sampleUrl');

fetchMediaBtn.onclick = async () => {
    const query = brandQueryInput.value.trim();
    if (!query) return;

    fetchMediaBtn.innerHTML = '<span class="spinner"></span> Scouring Maps...';
    fetchMediaBtn.classList.add('loading');

    try {
        const response = await fetch('/api/brand/fetch', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query })
        });
        const data = await response.json();
        if (response.ok) {
            currentBrandData = data;
            foundBrandName.innerText = `Found: ${data.brand_name}`;
            mediaGrid.innerHTML = data.media.map(m => `
                <div style="position: relative;">
                    <img src="${m.url}" style="width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: 4px; border: 1px solid var(--border);">
                    ${m.is_video ? '<span style="position: absolute; bottom: 4px; right: 4px; background: rgba(0,0,0,0.6); font-size: 0.6rem; padding: 2px 4px; border-radius: 2px;">VIDEO</span>' : ''}
                </div>
            `).join('');
            step1.style.display = 'none';
            step2.style.display = 'block';
        } else {
            throw new Error(data.detail || 'Brand search failed');
        }
    } catch (error) {
        console.error('Fetch error:', error);
        alert('Fetch failed: ' + error.message);
    } finally {
        fetchMediaBtn.innerText = 'Fetch Brand Media';
        fetchMediaBtn.classList.remove('loading');
    }
};

brandReelBtn.onclick = async () => {
    if (!currentBrandData) return;

    const sampleUrl = sampleUrlInput.value.trim();

    brandReelBtn.innerHTML = '<span class="spinner"></span> Remixing Assets & Audio...';
    brandReelBtn.classList.add('loading');

    try {
        const response = await fetch('/api/generate/brand-reel', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                brand_name: currentBrandData.brand_name,
                media_urls: currentBrandData.media.map(m => m.url),
                sample_url: sampleUrl || null
            })
        });
        const reel = await response.json();
        if (response.ok) {
            fetchVideos();
            playVideo(reel.id, reel.name, reel.stream_url);
            resetBrandStudio();
        } else {
            throw new Error(reel.detail || 'Remix failed');
        }
    } catch (error) {
        console.error('Error creating brand reel:', error);
        alert('Remix failed: ' + error.message);
    } finally {
        brandReelBtn.innerText = 'Create Remixed Reel';
        brandReelBtn.classList.remove('loading');
    }
};

restartBtn.onclick = resetBrandStudio;

function resetBrandStudio() {
    step1.style.display = 'block';
    step2.style.display = 'none';
    currentBrandData = null;
    brandQueryInput.value = '';
    sampleUrlInput.value = '';
}

// Initial load
fetchVideos();
