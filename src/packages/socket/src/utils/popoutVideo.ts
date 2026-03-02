export interface PopoutHandle {
  close: () => void;
  isOpen: () => boolean;
  updateStream: (stream: MediaStream) => void;
}

export interface PopoutAudioOptions {
  initialVolume: number;
  onVolumeChange: (volume: number) => void;
}

// ── SVG icons ───────────────────────────────────────────────────────────

const PIN_SVG = [
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"',
  ' stroke-width="2" stroke-linecap="round" stroke-linejoin="round">',
  '<line x1="12" y1="17" x2="12" y2="22"/>',
  '<path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15',
  " 10.76V7a1 1 0 0 1 1-1h1V3H7v3h1a1 1 0 0 1 1 1v3.76a2 2 0 0 1-1.11",
  ' 1.79l-1.78.9A2 2 0 0 0 5 15.24z"/>',
  "</svg>",
].join("");

const VOLUME_UP_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
  '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0014 7.97v8.05c1.48-.73 2.5-2.25 2.5-4.02z' +
  "M14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z" +
  '"/></svg>';

const VOLUME_OFF_SVG =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">' +
  '<path d="M16.5 12A4.5 4.5 0 0014 7.97v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 ' +
  "2.64l1.51 1.51A8.8 8.8 0 0021 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 " +
  "7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a10.18 10.18 0 003.69-1.81L19.73 21 " +
  '21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';

const CLOSE_SVG =
  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"' +
  ' stroke-width="2.5" stroke-linecap="round">' +
  '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

// ── Styles ──────────────────────────────────────────────────────────────

const POPUP_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #000;
    display: flex;
    flex-direction: column;
    height: 100vh;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    color: #e0e0e6;
    overflow: hidden;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    background: #111318;
    font-size: 13px;
    flex-shrink: 0;
    user-select: none;
    -webkit-app-region: drag;
  }
  .toolbar .title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 500;
  }
  .controls {
    display: flex;
    align-items: center;
    gap: 6px;
    -webkit-app-region: no-drag;
  }
  .toolbar button {
    background: transparent;
    border: 1px solid #444;
    border-radius: 6px;
    color: #e0e0e6;
    cursor: pointer;
    padding: 4px 10px;
    font-size: 12px;
    display: flex;
    align-items: center;
    gap: 4px;
    transition: background 0.15s, border-color 0.15s, color 0.15s;
    -webkit-app-region: no-drag;
  }
  .toolbar button:hover { background: rgba(255,255,255,0.08); }
  .toolbar button.pinned { border-color: #3b82f6; color: #3b82f6; }
  .toolbar button.icon-btn {
    border: none;
    padding: 4px;
    border-radius: 4px;
  }
  .toolbar button.close-btn {
    border: none;
    padding: 4px;
    border-radius: 4px;
  }
  .toolbar button.close-btn:hover { background: rgba(255,60,60,0.3); }
  .volume-group {
    display: flex;
    align-items: center;
    gap: 4px;
    -webkit-app-region: no-drag;
  }
  input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    width: 80px;
    height: 4px;
    border-radius: 2px;
    background: #333;
    outline: none;
    cursor: pointer;
  }
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: #e0e0e6;
    cursor: pointer;
    border: none;
  }
  video {
    flex: 1;
    min-height: 0;
    width: 100%;
    object-fit: contain;
    background: #000;
  }
`;

// ── Helpers ─────────────────────────────────────────────────────────────

function updateSliderFill(slider: HTMLInputElement) {
  const val = Number(slider.value);
  const max = Number(slider.max);
  const pct = (val / max) * 100;
  slider.style.background = `linear-gradient(to right, #3b82f6 ${pct}%, #333 ${pct}%)`;
}

function setupPopupWindow(
  win: Window,
  stream: MediaStream,
  title: string,
  audio?: PopoutAudioOptions,
): HTMLVideoElement {
  const doc = win.document;

  const style = doc.createElement("style");
  style.textContent = POPUP_STYLES;
  doc.head.appendChild(style);

  doc.title = title;

  const toolbar = doc.createElement("div");
  toolbar.className = "toolbar";

  const titleSpan = doc.createElement("span");
  titleSpan.className = "title";
  titleSpan.textContent = title;
  toolbar.appendChild(titleSpan);

  const controls = doc.createElement("div");
  controls.className = "controls";

  // ── Volume controls ─────────────────────────────────────────────────
  if (audio) {
    const volumeGroup = doc.createElement("div");
    volumeGroup.className = "volume-group";

    let currentVolume = audio.initialVolume;

    const muteBtn = doc.createElement("button");
    muteBtn.className = "icon-btn";
    muteBtn.title = currentVolume > 0 ? "Mute" : "Unmute";
    muteBtn.innerHTML = currentVolume > 0 ? VOLUME_UP_SVG : VOLUME_OFF_SVG;

    const slider = doc.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "200";
    slider.step = "1";
    slider.value = String(currentVolume);
    updateSliderFill(slider);

    const syncUI = (vol: number) => {
      currentVolume = vol;
      muteBtn.innerHTML = vol > 0 ? VOLUME_UP_SVG : VOLUME_OFF_SVG;
      muteBtn.title = vol > 0 ? "Mute" : "Unmute";
      slider.value = String(vol);
      updateSliderFill(slider);
    };

    slider.addEventListener("input", () => {
      const v = Number(slider.value);
      syncUI(v);
      audio.onVolumeChange(v);
    });

    muteBtn.addEventListener("click", () => {
      const next = currentVolume > 0 ? 0 : 100;
      syncUI(next);
      audio.onVolumeChange(next);
    });

    volumeGroup.appendChild(muteBtn);
    volumeGroup.appendChild(slider);
    controls.appendChild(volumeGroup);
  }

  // ── Pin button (Electron only) ──────────────────────────────────────
  const electronAPI = window.electronAPI;
  if (electronAPI) {
    const pinBtn = doc.createElement("button");
    let pinned = false;
    pinBtn.innerHTML = `${PIN_SVG} Pin`;
    pinBtn.title = "Keep window on top";
    pinBtn.onclick = () => {
      pinned = !pinned;
      pinBtn.classList.toggle("pinned", pinned);
      pinBtn.innerHTML = `${PIN_SVG} ${pinned ? "Pinned" : "Pin"}`;
      electronAPI.toggleAlwaysOnTop(pinned, title);
    };
    controls.appendChild(pinBtn);
  }

  // ── Close button ────────────────────────────────────────────────────
  const closeBtn = doc.createElement("button");
  closeBtn.className = "close-btn";
  closeBtn.innerHTML = CLOSE_SVG;
  closeBtn.title = "Close";
  closeBtn.onclick = () => win.close();
  controls.appendChild(closeBtn);

  toolbar.appendChild(controls);
  doc.body.appendChild(toolbar);

  const video = doc.createElement("video");
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  doc.body.appendChild(video);

  return video;
}

function addTrackEndedListeners(
  videoEl: HTMLVideoElement,
  stream: MediaStream,
  closePopup: () => void,
) {
  for (const track of stream.getTracks()) {
    track.addEventListener("ended", () => {
      const current = videoEl.srcObject as MediaStream | null;
      if (current && current.getTracks().every((t) => t.readyState === "ended")) {
        closePopup();
      }
    });
  }
}

export function popoutStream(
  stream: MediaStream,
  title: string,
  options?: {
    width?: number;
    height?: number;
    onClose?: () => void;
    audio?: PopoutAudioOptions;
  },
): PopoutHandle | null {
  const { width = 640, height = 480, onClose, audio } = options ?? {};

  try {
    const popup = window.open(
      "about:blank",
      "_blank",
      `width=${width},height=${height},resizable=yes`,
    );
    if (!popup) throw new Error("Popup blocked");

    let open = true;
    let activeStream = stream;

    const markClosed = () => {
      if (!open) return;
      open = false;
      clearInterval(checkInterval);
      onClose?.();
    };

    const videoEl = setupPopupWindow(popup, stream, title, audio);
    addTrackEndedListeners(videoEl, stream, () => {
      popup.close();
      markClosed();
    });

    const checkInterval = setInterval(() => {
      if (popup.closed) markClosed();
    }, 500);

    popup.addEventListener("beforeunload", markClosed);

    return {
      close: () => {
        markClosed();
        try { popup.close(); } catch { /* already closed */ }
      },
      isOpen: () => open && !popup.closed,
      updateStream: (newStream: MediaStream) => {
        if (newStream === activeStream) return;
        activeStream = newStream;
        videoEl.srcObject = newStream;
        addTrackEndedListeners(videoEl, newStream, () => {
          popup.close();
          markClosed();
        });
      },
    };
  } catch (err) {
    console.warn("[Popout] window.open failed:", err);
    return null;
  }
}
