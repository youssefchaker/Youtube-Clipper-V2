// ============================================
// CONTENT SCRIPT - youtube.com
// ============================================

let clipPanel = null;
let isCapturing = false;
let captureMonitor = null;
let recorder = null;
let recordingChunks = [];
let rafId = null;
let safetyTimeout = null;
let stopRequested = false;
let audioContext = null;
let audioDestination = null;

// ============================================
// SAVED CLIP STORAGE
// ============================================
let savedClip = {
  blob: null,
  url: null,
  filename: null,
  extension: null,
  timestamp: null
};

// ============================================
// YOUTUBE PLAYER UTILITIES
// ============================================

function getPlayer() {
  return document.getElementById('movie_player');
}

function getVideoElement() {
  return document.querySelector('video');
}

function getCurrentTime() {
  const player = getPlayer();
  if (player && typeof player.getCurrentTime === 'function') {
    return player.getCurrentTime();
  }
  const video = getVideoElement();
  return video ? video.currentTime : 0;
}

function getDuration() {
  const player = getPlayer();
  if (player && typeof player.getDuration === 'function') {
    return player.getDuration();
  }
  const video = getVideoElement();
  return video ? video.duration : 0;
}

function seekTo(time) {
  const player = getPlayer();
  if (player && typeof player.seekTo === 'function') {
    player.seekTo(time, true);
    return;
  }
  const video = getVideoElement();
  if (video) video.currentTime = time;
}

function pauseVideo() {
  const player = getPlayer();
  if (player && typeof player.pauseVideo === 'function') {
    player.pauseVideo();
    return;
  }
  const video = getVideoElement();
  if (video) video.pause();
}

function playVideo() {
  const player = getPlayer();
  if (player && typeof player.playVideo === 'function') {
    player.playVideo();
    return;
  }
  const video = getVideoElement();
  if (video) video.play();
}

function getVideoTitle() {
  const titleEl = document.querySelector('h1.style-scope.ytd-watch-metadata yt-formatted-string, h1.title.style-scope.ytd-video-primary-info-renderer, #title h1');
  return titleEl ? titleEl.textContent.trim() : 'youtube_clip';
}

// ============================================
// UI INJECTION - Clip Button
// ============================================

function injectClipButton() {
  if (document.getElementById('yt-clipper-btn')) return;

  const actionsRow = document.querySelector('#actions #top-level-buttons-computed, ytd-menu-renderer#menu ytd-button-renderer, #top-level-buttons');
  if (!actionsRow) return;

  const btn = document.createElement('button');
  btn.id = 'yt-clipper-btn';

  btn.className = 'yt-spec-button-shape-next yt-spec-button-shape-next--tonal yt-spec-button-shape-next--mono yt-spec-button-shape-next--size-m';
  btn.setAttribute('aria-label', 'Create clip');
  btn.setAttribute('title', 'Create a clip');

  btn.style.cssText = `
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    margin-left: 8px;
    cursor: pointer;
    border-radius: 18px;
    background: rgba(255, 255, 255, 0.1);
    color: #f1f1f1;
    border: none;
    padding: 0 16px;
    height: 36px;
    font-family: "Roboto", "Arial", sans-serif;
    font-size: 14px;
    font-weight: 500;
    letter-spacing: 0.5px;
    transition: background-color 0.2s ease;
  `;

  btn.innerHTML = `
    <div class="yt-spec-button-shape-next__icon" style="display:flex;align-items:center;justify-content:center;width:24px;height:24px;flex-shrink:0;">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
        <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4zM14 13h-3v3H9v-3H6v-2h3V8h2v3h3v2z"/>
      </svg>
    </div>
    <span class="yt-spec-button-shape-next__button-text-content" style="font-weight:500;">Clip</span>
  `;

  btn.addEventListener('mouseenter', () => {
    btn.style.background = 'rgba(255, 255, 255, 0.2)';
  });

  btn.addEventListener('mouseleave', () => {
    const isOpen = !!document.getElementById('yt-clipper-panel');
    btn.style.background = isOpen ? 'rgba(255, 255, 255, 0.2)' : 'rgba(255, 255, 255, 0.1)';
  });

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    const isOpen = !!document.getElementById('yt-clipper-panel');
    toggleClipPanel();

    btn.style.background = isOpen ? 'rgba(255, 255, 255, 0.1)' : 'rgba(255, 255, 255, 0.2)';
  });

  actionsRow.appendChild(btn);
}
// ============================================
// CLIP PANEL UI
// ============================================

function createClipPanel() {
  const panel = document.createElement('div');
  panel.id = 'yt-clipper-panel';

  const currentTime = getCurrentTime();
  const duration = getDuration();
  const safeEnd = Math.min(currentTime + 30, duration);

  panel.innerHTML = `
    <div class="yt-clipper-header">
      <span class="yt-clipper-title">Create Clip</span>
      <button class="yt-clipper-close" id="yt-clipper-close">×</button>
    </div>

    <div class="yt-clipper-body">
      <div class="yt-clipper-time-row">
        <div class="yt-clipper-field">
          <label>Start</label>
          <div class="yt-clipper-time-input">
            <input type="number" id="yt-clipper-start-h" min="0" value="${Math.floor(currentTime / 3600)}" placeholder="HH">
            <span>:</span>
            <input type="number" id="yt-clipper-start-m" min="0" max="59" value="${Math.floor((currentTime % 3600) / 60)}" placeholder="MM">
            <span>:</span>
            <input type="number" id="yt-clipper-start-s" min="0" max="59" value="${Math.floor(currentTime % 60)}" placeholder="SS">
          </div>
        </div>

        <div class="yt-clipper-field">
          <label>End</label>
          <div class="yt-clipper-time-input">
            <input type="number" id="yt-clipper-end-h" min="0" value="${Math.floor(safeEnd / 3600)}" placeholder="HH">
            <span>:</span>
            <input type="number" id="yt-clipper-end-m" min="0" max="59" value="${Math.floor((safeEnd % 3600) / 60)}" placeholder="MM">
            <span>:</span>
            <input type="number" id="yt-clipper-end-s" min="0" max="59" value="${Math.floor(safeEnd % 60)}" placeholder="SS">
          </div>
        </div>
      </div>

      <div class="yt-clipper-info" id="yt-clipper-info">
        Duration: <span id="yt-clipper-dur-display">0:00</span> <span style="color:#666;">(max 1:00)</span>
      </div>

      <div class="yt-clipper-actions">
        <button class="yt-clipper-btn yt-clipper-btn-secondary" id="yt-clipper-set-start">Set Start</button>
        <button class="yt-clipper-btn yt-clipper-btn-secondary" id="yt-clipper-set-end">Set End</button>
      </div>

      <button class="yt-clipper-btn yt-clipper-btn-primary" id="yt-clipper-capture">
        <span id="yt-clipper-capture-text">Capture Clip</span>
      </button>

      <button class="yt-clipper-btn yt-clipper-btn-danger" id="yt-clipper-cancel" style="display:none;">
        <span>Cancel Recording</span>
      </button>

      <div class="yt-clipper-saved" id="yt-clipper-saved" style="display:none;">
        <div class="yt-clipper-saved-info">
          <span class="yt-clipper-saved-icon">✓</span>
          <span>Clip ready!</span>
        </div>
        <button class="yt-clipper-btn yt-clipper-btn-success" id="yt-clipper-download">
          <span>💾 Save</span>
        </button>
        <button class="yt-clipper-btn yt-clipper-btn-discard" id="yt-clipper-discard">
          <span>🗑️ Discard</span>
        </button>
      </div>

      <div class="yt-clipper-progress" id="yt-clipper-progress" style="display:none;">
        <div class="yt-clipper-progress-bar">
          <div class="yt-clipper-progress-fill" id="yt-clipper-progress-fill"></div>
        </div>
        <span id="yt-clipper-progress-text">Recording... 0%</span>
      </div>

      <div class="yt-clipper-status" id="yt-clipper-status"></div>
    </div>
  `;

  document.body.appendChild(panel);
  clipPanel = panel;

  setupPanelEvents();
  updateDurationDisplay();
}

function setupPanelEvents() {
  const closeBtn = document.getElementById('yt-clipper-close');
  const setStartBtn = document.getElementById('yt-clipper-set-start');
  const setEndBtn = document.getElementById('yt-clipper-set-end');
  const captureBtn = document.getElementById('yt-clipper-capture');
  const cancelBtn = document.getElementById('yt-clipper-cancel');
  const downloadBtn = document.getElementById('yt-clipper-download');
  const discardBtn = document.getElementById('yt-clipper-discard');

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (isCapturing) cancelCapture();
      closeClipPanel();
    });
  }

  if (setStartBtn) {
    setStartBtn.addEventListener('click', () => {
      const t = getCurrentTime();
      setTimeInput('start', t);
      enforceMaxDuration();
      updateDurationDisplay();
    });
  }

  if (setEndBtn) {
    setEndBtn.addEventListener('click', () => {
      const t = getCurrentTime();
      setTimeInput('end', t);
      enforceMaxDuration();
      updateDurationDisplay();
    });
  }

  ['start-h', 'start-m', 'start-s', 'end-h', 'end-m', 'end-s'].forEach(id => {
    const el = document.getElementById(`yt-clipper-${id}`);
    if (el) {
      el.addEventListener('input', () => {
        enforceMaxDuration();
        updateDurationDisplay();
      });
    }
  });

  if (captureBtn) {
    captureBtn.addEventListener('click', startCapture);
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', cancelCapture);
  }

  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadSavedClip);
  }

  if (discardBtn) {
    discardBtn.addEventListener('click', discardSavedClip);
  }
}

function getTimeInput(prefix) {
  const h = parseInt(document.getElementById(`yt-clipper-${prefix}-h`).value) || 0;
  const m = parseInt(document.getElementById(`yt-clipper-${prefix}-m`).value) || 0;
  const s = parseInt(document.getElementById(`yt-clipper-${prefix}-s`).value) || 0;
  return h * 3600 + m * 60 + s;
}

function setTimeInput(prefix, totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  document.getElementById(`yt-clipper-${prefix}-h`).value = h;
  document.getElementById(`yt-clipper-${prefix}-m`).value = m;
  document.getElementById(`yt-clipper-${prefix}-s`).value = s;
}

function enforceMaxDuration() {
  const start = getTimeInput('start');
  let end = getTimeInput('end');
  const maxEnd = start + 60;

  if (end > maxEnd) {
    end = maxEnd;
    setTimeInput('end', end);
  }
  if (end < start) {
    end = start + 1;
    setTimeInput('end', end);
  }

  const duration = getDuration();
  if (end > duration) {
    setTimeInput('end', duration);
  }
}

function updateDurationDisplay() {
  const start = getTimeInput('start');
  const end = getTimeInput('end');
  const el = document.getElementById('yt-clipper-dur-display');
  if (el) el.textContent = formatTime(end - start);
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function toggleClipPanel() {
  if (clipPanel) {
    closeClipPanel();
  } else {
    createClipPanel();
  }
}

function closeClipPanel() {
  if (clipPanel) {
    clipPanel.remove();
    clipPanel = null;
  }
  const btn = document.getElementById('yt-clipper-btn');
  if (btn) btn.style.background = 'rgba(255, 255, 255, 0.1)';
}

function showStatus(msg, type = 'info') {
  const el = document.getElementById('yt-clipper-status');
  if (!el) return;
  el.textContent = msg;
  el.className = `yt-clipper-status yt-clipper-status-${type}`;
  el.style.display = 'block';
}

function clearStatus() {
  const el = document.getElementById('yt-clipper-status');
  if (el) {
    el.textContent = '';
    el.style.display = 'none';
  }
}

// ============================================
// SAVED CLIP UI
// ============================================

function showSavedClipUI() {
  const savedDiv = document.getElementById('yt-clipper-saved');
  const captureBtn = document.getElementById('yt-clipper-capture');
  const cancelBtn = document.getElementById('yt-clipper-cancel');
  const progress = document.getElementById('yt-clipper-progress');

  if (savedDiv) savedDiv.style.display = 'block';
  if (captureBtn) captureBtn.style.display = 'none';
  if (cancelBtn) cancelBtn.style.display = 'none';
  if (progress) progress.style.display = 'none';
}

function hideSavedClipUI() {
  const savedDiv = document.getElementById('yt-clipper-saved');
  const captureBtn = document.getElementById('yt-clipper-capture');

  if (savedDiv) savedDiv.style.display = 'none';
  if (captureBtn) captureBtn.style.display = 'block';
}

function discardSavedClip() {
  if (savedClip.url) {
    URL.revokeObjectURL(savedClip.url);
  }
  savedClip = { blob: null, url: null, filename: null, extension: null, timestamp: null };
  hideSavedClipUI();
}

function downloadSavedClip() {
  if (!savedClip.url || !savedClip.blob) {
    showStatus('No clip to download', 'error');
    return;
  }

  chrome.runtime.sendMessage({
    action: 'DOWNLOAD_CLIP',
    blobUrl: savedClip.url,
    filename: savedClip.filename,
    extension: savedClip.extension
  }, (response) => {
    if (chrome.runtime.lastError) {
      showStatus('Download error: ' + chrome.runtime.lastError.message, 'error');
    } else {
    }
  });
}

// ============================================
// CAPTURE LOGIC
// ============================================

function discardOldClip() {
  if (savedClip.url) {
    URL.revokeObjectURL(savedClip.url);
    savedClip = { blob: null, url: null, filename: null, extension: null, timestamp: null };
  }
  hideSavedClipUI();
}

async function startCapture() {
  if (isCapturing) return;

  // Discard any previous clip before starting new capture
  discardOldClip();

  const startTime = getTimeInput('start');
  const endTime = getTimeInput('end');

  if (endTime <= startTime) {
    return;
  }

  if (endTime - startTime > 60) {
    return;
  }

  const video = getVideoElement();
  if (!video) {
    showStatus('Video element not found', 'error');
    return;
  }

  isCapturing = true;
  stopRequested = false;
  clearStatus();

  const captureBtn = document.getElementById('yt-clipper-capture');
  const cancelBtn = document.getElementById('yt-clipper-cancel');
  const progress = document.getElementById('yt-clipper-progress');

  if (captureBtn) captureBtn.style.display = 'none';
  if (cancelBtn) cancelBtn.style.display = 'block';
  if (progress) progress.style.display = 'block';

  try {
    await performRecording(video, startTime, endTime);
  } catch (err) {
    console.error('[Clipper] Capture error:', err);
    showStatus('Recording failed: ' + err.message, 'error');
    resetCaptureUI();
  }
}

function cancelCapture() {
  if (!isCapturing) return;

  console.log('[Clipper] User cancelled recording');

  stopRequested = true;
  isCapturing = false;

  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (captureMonitor) {
    clearInterval(captureMonitor);
    captureMonitor = null;
  }

  if (safetyTimeout) {
    clearTimeout(safetyTimeout);
    safetyTimeout = null;
  }

  if (audioContext) {
    try { audioContext.close(); } catch (e) { }
    audioContext = null;
    audioDestination = null;
  }

  pauseVideo();

  if (recorder) {
    try {
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
    } catch (e) {
      console.warn('[Clipper] Error stopping recorder:', e);
    }

    try {
      if (recorder.stream) {
        recorder.stream.getTracks().forEach(t => t.stop());
      }
    } catch (e) {
      console.warn('[Clipper] Error stopping tracks:', e);
    }

    recorder = null;
  }

  recordingChunks = [];
  resetCaptureUI();
}

async function performRecording(video, startTime, endTime) {
  const duration = endTime - startTime;

  // Setup canvas
  const maxWidth = 1920;
  const scale = video.videoWidth > maxWidth ? maxWidth / video.videoWidth : 1;
  const canvasWidth = Math.floor(video.videoWidth * scale) || 1280;
  const canvasHeight = Math.floor(video.videoHeight * scale) || 720;

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d', { alpha: false });

  // Setup streams
  const canvasStream = canvas.captureStream(30);
  let combinedStream = canvasStream;

  // Audio capture
  let audioCaptured = false;

  try {
    if (video.captureStream) {
      const videoMediaStream = video.captureStream();
      const audioTracks = videoMediaStream.getAudioTracks();
      if (audioTracks.length > 0) {
        combinedStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioTracks
        ]);
        audioCaptured = true;
        console.log('[Clipper] Audio captured via video.captureStream()');
      }
    }
  } catch (e) {
    console.warn('[Clipper] video.captureStream() failed:', e);
  }

  if (!audioCaptured) {
    try {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioDestination = audioContext.createMediaStreamDestination();

      const source = audioContext.createMediaElementSource(video);
      source.connect(audioDestination);
      source.connect(audioContext.destination);

      const audioTracks = audioDestination.stream.getAudioTracks();
      if (audioTracks.length > 0) {
        combinedStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioTracks
        ]);
        audioCaptured = true;
        console.log('[Clipper] Audio captured via Web Audio API');
      }
    } catch (e) {
      console.warn('[Clipper] Web Audio API failed:', e);
    }
  }

  // Try MP4 first, fall back to WebM
  const mp4MimeTypes = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4;codecs=h264,aac',
    'video/mp4'
  ];

  const webmMimeTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm'
  ];

  let selectedMimeType = '';
  let outputExtension = 'webm';

  for (const type of mp4MimeTypes) {
    if (MediaRecorder.isTypeSupported(type)) {
      selectedMimeType = type;
      outputExtension = 'mp4';
      console.log('[Clipper] Using native MP4 recording:', type);
      break;
    }
  }

  if (!selectedMimeType) {
    for (const type of webmMimeTypes) {
      if (MediaRecorder.isTypeSupported(type)) {
        selectedMimeType = type;
        outputExtension = 'webm';
        console.log('[Clipper] Using WebM recording:', type);
        break;
      }
    }
  }

  if (!selectedMimeType) {
    throw new Error('No supported MediaRecorder mimeType found');
  }

  recorder = new MediaRecorder(combinedStream, {
    mimeType: selectedMimeType,
    videoBitsPerSecond: 8000000
  });

  recordingChunks = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      recordingChunks.push(e.data);
      console.log('[Clipper] Data chunk received:', e.data.size, 'bytes');
    }
  };

  recorder.onstop = () => {
    console.log('[Clipper] Recorder stopped. stopRequested:', stopRequested, 'chunks:', recordingChunks.length);

    if (audioContext) {
      try { audioContext.close(); } catch (e) { }
      audioContext = null;
      audioDestination = null;
    }

    if (!stopRequested) {
      finalizeRecording(outputExtension);
    } else {
      recordingChunks = [];
      if (recorder && recorder.stream) {
        recorder.stream.getTracks().forEach(t => {
          try { t.stop(); } catch (e) { }
        });
      }
      recorder = null;
    }
  };

  recorder.onerror = (e) => {
    console.error('[Clipper] Recorder error:', e);
    if (isCapturing && !stopRequested) {
      showStatus('Recorder error: ' + e.message, 'error');
      resetCaptureUI();
    }
  };

  // Seek to start
  pauseVideo();
  await new Promise(r => setTimeout(r, 200));
  seekTo(startTime);
  await waitForVideoReady(video);

  if (audioContext && audioContext.state === 'suspended') {
    await audioContext.resume();
  }

  // Start recording
  recorder.start(1000);
  console.log('[Clipper] Recorder started, state:', recorder.state);

  // Start playing
  playVideo();

  // Frame draw loop
  const drawFrame = () => {
    if (!isCapturing) return;
    try {
      ctx.drawImage(video, 0, 0, canvasWidth, canvasHeight);
    } catch (e) {
      console.warn('[Clipper] Draw error:', e);
    }
    rafId = requestAnimationFrame(drawFrame);
  };
  drawFrame();

  // Progress monitoring
  const totalDuration = endTime - startTime;
  const progressFill = document.getElementById('yt-clipper-progress-fill');
  const progressText = document.getElementById('yt-clipper-progress-text');

  captureMonitor = setInterval(() => {
    if (!isCapturing) return;

    const current = getCurrentTime();
    const elapsed = current - startTime;
    const pct = Math.min(100, (elapsed / totalDuration) * 100);

    if (progressFill) progressFill.style.width = pct + '%';
    if (progressText) {
      progressText.textContent = `Recording... ${Math.floor(pct)}% (${formatTime(elapsed)} / ${formatTime(totalDuration)})`;
    }

    if (current >= endTime || pct >= 100) {
      stopRecording();
    }
  }, 250);

  // Safety timeout
  safetyTimeout = setTimeout(() => {
    if (isCapturing) {
      console.warn('[Clipper] Safety timeout triggered');
      stopRecording();
    }
  }, (duration + 15) * 1000);
}

function waitForVideoReady(video) {
  return new Promise((resolve) => {
    let resolved = false;

    const onSeeked = () => {
      if (resolved) return;
      resolved = true;
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };

    video.addEventListener('seeked', onSeeked);

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        video.removeEventListener('seeked', onSeeked);
        resolve();
      }
    }, 1000);
  });
}

function stopRecording() {
  if (!isCapturing) return;

  console.log('[Clipper] Stopping recording (normal completion)...');

  stopRequested = false;

  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (captureMonitor) {
    clearInterval(captureMonitor);
    captureMonitor = null;
  }

  if (safetyTimeout) {
    clearTimeout(safetyTimeout);
    safetyTimeout = null;
  }

  pauseVideo();

  if (recorder && recorder.state !== 'inactive') {
    try {
      recorder.stop();
      console.log('[Clipper] Recorder.stop() called, state:', recorder.state);
    } catch (e) {
      console.warn('[Clipper] Error stopping recorder:', e);
      isCapturing = false;
      resetCaptureUI();
    }
  } else {
    console.log('[Clipper] Recorder already inactive');
    isCapturing = false;
    resetCaptureUI();
  }
}

function finalizeRecording(extension) {
  console.log('[Clipper] Finalizing recording, chunks:', recordingChunks.length, 'extension:', extension);

  isCapturing = false;

  // Store mimeType before we potentially null out recorder
  const recordedMimeType = recorder ? recorder.mimeType : `video/${extension}`;

  if (recorder && recorder.stream) {
    recorder.stream.getTracks().forEach(t => {
      try { t.stop(); } catch (e) { }
    });
  }

  if (recordingChunks.length === 0) {
    showStatus('No data was recorded', 'error');
    resetCaptureUI();
    return;
  }

  const blob = new Blob(recordingChunks, { type: recordedMimeType });
  const blobUrl = URL.createObjectURL(blob);
  console.log('[Clipper] Blob created:', blob.size, 'bytes');

  const filename = getVideoTitle().substring(0, 50).replace(/[^a-zA-Z0-9_-]/g, '_');

  // Store in memory instead of downloading
  savedClip = {
    blob: blob,
    url: blobUrl,
    filename: filename,
    extension: extension,
    timestamp: Date.now()
  };

  recordingChunks = [];
  recorder = null;

  // Show the saved clip UI
  showSavedClipUI();
}

function resetCaptureUI() {
  isCapturing = false;
  stopRequested = false;

  const captureBtn = document.getElementById('yt-clipper-capture');
  const cancelBtn = document.getElementById('yt-clipper-cancel');
  const progress = document.getElementById('yt-clipper-progress');
  const progressFill = document.getElementById('yt-clipper-progress-fill');
  const progressText = document.getElementById('yt-clipper-progress-text');

  if (captureBtn) {
    captureBtn.style.display = 'block';
    captureBtn.disabled = false;
  }
  if (cancelBtn) cancelBtn.style.display = 'none';
  if (progress) progress.style.display = 'none';
  if (progressFill) progressFill.style.width = '0%';
  if (progressText) progressText.textContent = 'Recording... 0%';
}

// ============================================
// MESSAGE HANDLING
// ============================================

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case 'CLIP_ERROR':
      showStatus('Error: ' + request.error, 'error');
      resetCaptureUI();
      break;
    default:
      sendResponse({ status: 'ok' });
  }
  return true;
});

// ============================================
// INITIALIZATION
// ============================================

function init() {
  const observer = new MutationObserver(() => {
    const video = getVideoElement();
    const actionsRow = document.querySelector('#actions #top-level-buttons-computed, ytd-menu-renderer#menu ytd-button-renderer, #top-level-buttons');

    if (video && actionsRow && !document.getElementById('yt-clipper-btn')) {
      injectClipButton();
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  document.addEventListener('yt-navigate-finish', () => {
    setTimeout(() => injectClipButton(), 1000);
  });

  setTimeout(() => injectClipButton(), 2000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}