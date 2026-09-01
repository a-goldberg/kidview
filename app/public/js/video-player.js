(() => {
  const root = document.querySelector('[data-kidview-player]');

  if (!root) return;

  const videoId = Number(root.dataset.videoId);
  const youtubeVideoId = root.dataset.youtubeVideoId;
  const stage = root.querySelector('[data-player-stage]');
  const status = root.querySelector('[data-player-status]');
  let playbackId = null;
  let player = null;
  let lastProgressSecond = -1;
  let progressInFlight = false;

  function showStatus(message, state) {
    status.textContent = message;
    status.dataset.state = state || '';
  }

  async function sendProgress({ final = false } = {}) {
    if (!playbackId || !player || progressInFlight) return;

    const currentTimeSeconds = Math.floor(player.getCurrentTime() || 0);
    if (!final && currentTimeSeconds < lastProgressSecond + 10) return;

    progressInFlight = true;
    try {
      const response = await fetch(`/child/videos/${videoId}/playback/progress`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ playbackId, currentTimeSeconds })
      });
      if (response.ok) lastProgressSecond = currentTimeSeconds;
    } catch (_) {
      // Playback may continue if a best-effort progress update is interrupted.
    } finally {
      progressInFlight = false;
    }
  }

  function loadIframeApi() {
    return new Promise((resolve, reject) => {
      if (window.YT && window.YT.Player) return resolve();
      const existing = document.querySelector('script[data-youtube-iframe-api]');
      const timeout = window.setTimeout(() => reject(new Error('Player timed out')), 15000);
      window.onYouTubeIframeAPIReady = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      if (!existing) {
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.dataset.youtubeIframeApi = 'true';
        script.onerror = () => {
          window.clearTimeout(timeout);
          reject(new Error('Player could not load'));
        };
        document.head.appendChild(script);
      }
    });
  }

  async function start() {
    if (!Number.isInteger(videoId) || !youtubeVideoId) {
      showStatus('This video is unavailable right now.', 'error');
      return;
    }
    try {
      const response = await fetch(`/child/videos/${videoId}/playback/start`, {
        method: 'POST',
        headers: { accept: 'application/json' }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        showStatus(payload.message || 'This video is unavailable right now.', 'error');
        return;
      }
      playbackId = payload.playback.id;
      const remaining = payload.playback.watchLimit && payload.playback.watchLimit.remaining;
      if (Number.isFinite(remaining)) {
        showStatus(`${remaining} video${remaining === 1 ? '' : 's'} left to start today.`);
      } else {
        showStatus('Ready to watch.');
      }
      await loadIframeApi();
      stage.innerHTML = '<div id="youtube-player"></div>';
      player = new window.YT.Player('youtube-player', {
        videoId: youtubeVideoId,
        host: 'https://www.youtube-nocookie.com',
        playerVars: { autoplay: 1, rel: 0, modestbranding: 1, playsinline: 1 },
        events: {
          onStateChange(event) {
            if (event.data === window.YT.PlayerState.PLAYING) sendProgress();
            if (event.data === window.YT.PlayerState.ENDED) sendProgress({ final: true });
          },
          onError() {
            showStatus('YouTube could not play this video here. Try another result.', 'error');
          }
        }
      });
      window.setInterval(() => sendProgress(), 10000);
      window.addEventListener('pagehide', () => sendProgress({ final: true }), { once: true });
    } catch (_) {
      showStatus('We could not start this video. Please try another result.', 'error');
    }
  }

  start();
})();
