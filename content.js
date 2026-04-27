// ============================================
// CONTENT SCRIPT - youtube.com
// Injects Clip button, manages panel UI,
// controls YouTube player, RECORDS directly via canvas
// ============================================

let clipPanel = null;
let isCapturing = false;
let captureMonitor = null;
let recorder = null;
let recordingChunks = [];
let rafId = null;

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

  btn.innerHTML = `
    <div class="yt-spec-button-shape-next__icon">
      <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
        <path d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4zM14 13h-3v3H9v-3H6v-2h3V8h2v3h3v2z"/>
      </svg>
    </div>
    <span class="yt-spec-button-shape-next__button-text-content">Clip</span>
  `;

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleClipPanel();
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
  const safeEnd = Math.min(currentTime + 60, duration);

  panel.innerHTML = `
    <div class="yt-clipper-header">
      <span class="yt-clipper-title">Create Clip</span>
      <button class="yt-clipper-close" id="yt-clipper-close">×</button>
    </div>
    
    <div class="yt-clipper-body">
      <div class="yt-clipper-field">
        <label>Clip Name</label>
        <input type="text" id="yt-clipper-name" placeholder="My awesome clip" value="${getVideoTitle().substring(0, 50)}_clip">
      </div>
      
      <div class="yt-clipper-time-row">
        <div class="yt-clipper-field">
          <label>Start</label>
          <div class="yt-clipper-time-input">
            <input type="number" id="yt-clipper-start-m" min="0" value="${Math.floor(currentTime / 60)}" placeholder="MM">
            <span>:</span>
            <input type="number" id="yt-clipper-start-s" min="0" max="59" value="${Math.floor(currentTime % 60)}" placeholder="SS">
          </div>
        </div>
        
        <div class="yt-clipper-field">
          <label>End</label>
          <div class="yt-clipper-time-input">
            <input type="number" id="yt-clipper-end-m" min="0" value="${Math.floor(safeEnd / 60)}" placeholder="MM">
            <span>:</span>
            <input type="number" id="yt-clipper-end-s" min="0" max="59" value="${Math.floor(safeEnd % 60)}" placeholder="SS">
          </div>
        </div>
      </div>
      
      <div class="yt-clipper-slider-container">
        <label>Quick Select (2 min max)</label>
        <div class="yt-clipper-slider-track">
          <div class="yt-clipper-slider-range" id="yt-clipper-range"></div>
          <div class="yt-clipper-slider-handle yt-clipper-handle-start" id="yt-clipper-handle-start"></div>
          <div class="yt-clipper-slider-handle yt-clipper-handle-end" id="yt-clipper-handle-end"></div>
        </div>
        <div class="yt-clipper-slider-labels">
          <span id="yt-clipper-label-start">0:00</span>
          <span id="yt-clipper-duration">2:00 max</span>
          <span id="yt-clipper-label-end">0:00</span>
        </div>
      </div>
      
      <div class="yt-clipper-info" id="yt-clipper-info">
        Duration: <span id="yt-clipper-dur-display">0:00</span>
      </div>
      
      <div class="yt-clipper-actions">
        <button class="yt-clipper-btn yt-clipper-btn-secondary" id="yt-clipper-set-start">Set Start (Current)</button>
        <button class="yt-clipper-btn yt-clipper-btn-secondary" id="yt-clipper-set-end">Set End (Current)</button>
      </div>
      
      <button class="yt-clipper-btn yt-clipper-btn-primary" id="yt-clipper-capture">
        <span id="yt-clipper-capture-text">Capture Clip</span>
      </button>
      
      <button class="yt-clipper-btn yt-clipper-btn-danger" id="yt-clipper-cancel" style="display:none;">
        <span>Cancel Recording</span>
      </button>
      
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
  updateSliderFromInputs();
}

function setupPanelEvents() {
  document.getElementById('yt-clipper-close').addEventListener('click', () => {
    if (isCapturing) {
      cancelCapture();
    }
    closeClipPanel();
  });

  document.getElementById('yt-clipper-set-start').addEventListener('click', () => {
    const t = getCurrentTime();
    setTimeInput('start', t);
    updateSliderFromInputs();
  });

  document.getElementById('yt-clipper-set-end').addEventListener('click', () => {
    const t = getCurrentTime();
    setTimeInput('end', t);
    updateSliderFromInputs();
  });

  ['start-m', 'start-s', 'end-m', 'end-s'].forEach(id => {
    document.getElementById(`yt-clipper-${id}`).addEventListener('input', () => {
      enforceMaxDuration();
      updateSliderFromInputs();
    });
  });

  document.getElementById('yt-clipper-capture').addEventListener('click', startCapture);
  document.getElementById('yt-clipper-cancel').addEventListener('click', cancelCapture);

  const track = document.querySelector('.yt-clipper-slider-track');
  track.addEventListener('click', (e) => {
    const rect = track.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    const duration = getDuration();
    const clickTime = pct * duration;

    const startTime = getTimeInput('start');
    const endTime = getTimeInput('end');
    const midPoint = (startTime + endTime) / 2;

    if (clickTime < midPoint) {
      setTimeInput('start', Math.max(0, clickTime));
    } else {
      setTimeInput('end', Math.min(duration, clickTime));
    }
    enforceMaxDuration();
    updateSliderFromInputs();
  });
}

function getTimeInput(prefix) {
  const m = parseInt(document.getElementById(`yt-clipper-${prefix}-m`).value) || 0;
  const s = parseInt(document.getElementById(`yt-clipper-${prefix}-s`).value) || 0;
  return m * 60 + s;
}

function setTimeInput(prefix, totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.floor(totalSeconds % 60);
  document.getElementById(`yt-clipper-${prefix}-m`).value = m;
  document.getElementById(`yt-clipper-${prefix}-s`).value = s;
}

function enforceMaxDuration() {
  const start = getTimeInput('start');
  let end = getTimeInput('end');
  const maxEnd = start + 120;

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

function updateSliderFromInputs() {
  const start = getTimeInput('start');
  const end = getTimeInput('end');
  const duration = getDuration() || 1;

  const startPct = (start / duration) * 100;
  const endPct = (end / duration) * 100;

  document.getElementById('yt-clipper-range').style.left = startPct + '%';
  document.getElementById('yt-clipper-range').style.width = (endPct - startPct) + '%';
  document.getElementById('yt-clipper-handle-start').style.left = startPct + '%';
  document.getElementById('yt-clipper-handle-end').style.left = endPct + '%';

  document.getElementById('yt-clipper-label-start').textContent = formatTime(start);
  document.getElementById('yt-clipper-label-end').textContent = formatTime(end);

  document.getElementById('yt-clipper-dur-display').textContent = formatTime(end - start);
}

function formatTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
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
}

function showStatus(msg, type = 'info') {
  const el = document.getElementById('yt-clipper-status');
  if (!el) return;
  el.textContent = msg;
  el.className = `yt-clipper-status yt-clipper-status-${type}`;
}

// ============================================
// CAPTURE LOGIC - Canvas + MediaRecorder
// ============================================

async function startCapture() {
  if (isCapturing) return;

  const name = document.getElementById('yt-clipper-name').value.trim() || 'clip';
  const startTime = getTimeInput('start');
  const endTime = getTimeInput('end');

  if (endTime <= startTime) {
    showStatus('End time must be after start time', 'error');
    return;
  }

  if (endTime - startTime > 120) {
    showStatus('Clip cannot exceed 2 minutes', 'error');
    return;
  }

  const video = getVideoElement();
  if (!video) {
    showStatus('Video element not found', 'error');
    return;
  }

  isCapturing = true;
  showStatus('Preparing capture...', 'info');

  // Switch buttons: hide Capture, show Cancel
  document.getElementById('yt-clipper-capture').style.display = 'none';
  document.getElementById('yt-clipper-cancel').style.display = 'block';
  document.getElementById('yt-clipper-progress').style.display = 'block';

  try {
    await performRecording(video, startTime, endTime, name);
  } catch (err) {
    showStatus('Recording failed: ' + err.message, 'error');
    resetCaptureUI();
  }
}

function cancelCapture() {
  if (!isCapturing) return;

  console.log('[Clipper] User cancelled recording');

  // Stop everything immediately
  isCapturing = false;

  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (captureMonitor) {
    clearInterval(captureMonitor);
    captureMonitor = null;
  }

  pauseVideo();

  if (recorder) {
    if (recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch (e) {
        // Ignore stop errors on cancel
      }
    }
    // Stop all tracks to release camera/mic resources
    if (recorder.stream) {
      recorder.stream.getTracks().forEach(t => {
        try { t.stop(); } catch (e) { }
      });
    }
    recorder = null;
  }

  recordingChunks = [];

  showStatus('Recording cancelled', 'info');
  resetCaptureUI();
}

async function performRecording(video, startTime, endTime, filename) {
  const duration = endTime - startTime;

  // 1. Create canvas at video resolution (capped)
  const maxWidth = 1920;
  const scale = video.videoWidth > maxWidth ? maxWidth / video.videoWidth : 1;
  const canvasWidth = Math.floor(video.videoWidth * scale) || 1280;
  const canvasHeight = Math.floor(video.videoHeight * scale) || 720;

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d', { alpha: false });

  // 2. Setup MediaRecorder from canvas stream
  const canvasStream = canvas.captureStream(30);

  // 3. Try to capture audio from the video element
  let combinedStream = canvasStream;
  try {
    if (video.captureStream) {
      const videoMediaStream = video.captureStream();
      const audioTracks = videoMediaStream.getAudioTracks();
      if (audioTracks.length > 0) {
        combinedStream = new MediaStream([
          ...canvasStream.getVideoTracks(),
          ...audioTracks
        ]);
        console.log('[Clipper] Audio track captured');
      } else {
        console.log('[Clipper] No audio track available');
      }
    }
  } catch (e) {
    console.warn('[Clipper] Could not capture audio:', e);
  }

  // 4. Determine supported mime type
  const mimeTypes = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=h264,opus',
    'video/webm',
    'video/mp4'
  ];

  let selectedMimeType = '';
  for (const type of mimeTypes) {
    if (MediaRecorder.isTypeSupported(type)) {
      selectedMimeType = type;
      break;
    }
  }

  if (!selectedMimeType) {
    throw new Error('No supported MediaRecorder mimeType found in this browser');
  }

  console.log('[Clipper] Using mimeType:', selectedMimeType);

  recorder = new MediaRecorder(combinedStream, {
    mimeType: selectedMimeType,
    videoBitsPerSecond: 8000000
  });

  recordingChunks = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) {
      recordingChunks.push(e.data);
    }
  };

  recorder.onstop = () => {
    // Only finalize if we weren't cancelled (isCapturing would be false on cancel)
    if (isCapturing) {
      finalizeRecording(filename);
    } else {
      // Cancelled — discard chunks
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
    if (isCapturing) {
      showStatus('Recorder error: ' + e.message, 'error');
      resetCaptureUI();
    }
  };

  // 5. Seek to start and wait
  pauseVideo();
  await new Promise(r => setTimeout(r, 200));
  seekTo(startTime);
  await waitForVideoReady(video);

  // 6. Start recording
  recorder.start(1000);

  // 7. Play video
  playVideo();

  // 8. Frame draw loop
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

  // 9. Monitor progress
  const totalDuration = endTime - startTime;
  const progressFill = document.getElementById('yt-clipper-progress-fill');
  const progressText = document.getElementById('yt-clipper-progress-text');

  captureMonitor = setInterval(() => {
    if (!isCapturing) return;

    const current = getCurrentTime();
    const elapsed = current - startTime;
    const pct = Math.min(100, (elapsed / totalDuration) * 100);

    progressFill.style.width = pct + '%';
    progressText.textContent = `Recording... ${Math.floor(pct)}% (${formatTime(elapsed)} / ${formatTime(totalDuration)})`;

    if (current >= endTime || pct >= 100) {
      stopRecording();
    }
  }, 250);

  // 10. Safety timeout
  setTimeout(() => {
    if (isCapturing) {
      console.warn('[Clipper] Safety timeout triggered');
      stopRecording();
    }
  }, (duration + 10) * 1000);
}

function waitForVideoReady(video) {
  return new Promise((resolve) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked);
      resolve();
    };
    video.addEventListener('seeked', onSeeked);
    setTimeout(resolve, 800);
  });
}

function stopRecording() {
  if (!isCapturing) return;

  isCapturing = false;

  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }

  if (captureMonitor) {
    clearInterval(captureMonitor);
    captureMonitor = null;
  }

  pauseVideo();

  if (recorder && recorder.state !== 'inactive') {
    recorder.stop();
  }
}

function finalizeRecording(filename) {
  // Stop all tracks
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

  const blob = new Blob(recordingChunks, { type: recorder.mimeType });
  const blobUrl = URL.createObjectURL(blob);

  chrome.runtime.sendMessage({
    action: 'DOWNLOAD_CLIP',
    blobUrl: blobUrl,
    filename: filename
  }, (response) => {
    if (chrome.runtime.lastError) {
      showStatus('Download error: ' + chrome.runtime.lastError.message, 'error');
    } else {
      showStatus('Clip saved! Check your downloads.', 'success');
    }
    resetCaptureUI();
  });

  recordingChunks = [];
  recorder = null;
}

function resetCaptureUI() {
  isCapturing = false;

  const captureBtn = document.getElementById('yt-clipper-capture');
  const cancelBtn = document.getElementById('yt-clipper-cancel');
  const progress = document.getElementById('yt-clipper-progress');

  if (captureBtn) {
    captureBtn.style.display = 'block';
    captureBtn.disabled = false;
  }
  if (cancelBtn) cancelBtn.style.display = 'none';
  if (progress) progress.style.display = 'none';
}

// ============================================
// LISTEN FOR BACKGROUND MESSAGES
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