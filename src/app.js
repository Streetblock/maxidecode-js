import { clamp } from "./maxicode/scanner.js";
import { AUTO_THRESHOLD_CANDIDATES, scanWithThresholds } from "./maxicode/adaptiveScan.js";
import { UpsMaxicodeReader } from "./ups/UpsMaxicodeReader.js";

const els = {
  statusPill: document.getElementById("statusPill"),
  resultPill: document.getElementById("resultPill"),
  confidenceValue: document.getElementById("confidenceValue"),
  sourceLabel: document.getElementById("sourceLabel"),
  decodedText: document.getElementById("decodedText"),
  upsSummary: document.getElementById("upsSummary"),
  upsTracking: document.getElementById("upsTracking"),
  upsPostal: document.getElementById("upsPostal"),
  upsCountry: document.getElementById("upsCountry"),
  upsService: document.getElementById("upsService"),
  upsFormat07: document.getElementById("upsFormat07"),
  modeValue: document.getElementById("modeValue"),
  centerValue: document.getElementById("centerValue"),
  pitchValue: document.getElementById("pitchValue"),
  bytesValue: document.getElementById("bytesValue"),
  rawBytes: document.getElementById("rawBytes"),
  rawMessage: document.getElementById("rawMessage"),
  resultNote: document.getElementById("resultNote"),
  fileInput: document.getElementById("fileInput"),
  uploadBtn: document.getElementById("uploadBtn"),
  pasteBtn: document.getElementById("pasteBtn"),
  cameraBtn: document.getElementById("cameraBtn"),
  cameraBtnLabel: document.getElementById("cameraBtnLabel"),
  clearBtn: document.getElementById("clearBtn"),
  copyBtn: document.getElementById("copyBtn"),
  resultPanel: document.getElementById("resultPanel"),
  resultToggle: document.getElementById("resultToggle"),
  dropzone: document.getElementById("dropzone"),
  previewCanvas: document.getElementById("previewCanvas"),
  idleState: document.getElementById("idleState"),
  cameraVideo: document.getElementById("cameraVideo"),
  sourceCanvas: document.getElementById("sourceCanvas"),
};

const state = {
  stream: null,
  cameraActive: false,
  scanTimer: null,
  phase: "idle",
  captureInFlight: false,
  sourceName: "",
  sourceKind: "idle",
  analysis: null,
  dragActive: false,
  thresholdAttempt: 0,
};

const previewCtx = els.previewCanvas.getContext("2d");
const sourceCtx = els.sourceCanvas.getContext("2d", { willReadFrequently: true });
const upsReader = new UpsMaxicodeReader();

function visibleControls(value) {
  return String(value ?? "")
    .replaceAll("\x1d", "<GS>")
    .replaceAll("\x1e", "<RS>")
    .replaceAll("\x1c", "<FS>")
    .replaceAll("\x04", "<EOT>")
    .replaceAll("\r", "<CR>\n");
}

function updateUpsSummary(ups) {
  const recognized = Boolean(ups?.recognized);
  els.upsSummary.hidden = !recognized;
  if (!recognized) return;

  els.upsTracking.textContent = ups.secondary.trackingNumberReconstructed
    || ups.secondary.trackingNumberEncoded
    || "Not available";
  els.upsPostal.textContent = ups.primary.postalCode || "-";
  els.upsCountry.textContent = ups.primary.countryCode || "-";
  els.upsService.textContent = ups.primary.serviceClass || "-";
  els.upsFormat07.textContent = ups.compressed
    ? ups.compressed.ok
      ? ups.compressed.decoder.complete ? "Decoded" : "Decoded (partial)"
      : "Transport recovered"
    : "Not present";
}

function formatUpsResult(ups) {
  if (!ups.compressed) {
    return "UPS routing fields decoded. No Format 07 segment is present.";
  }
  if (!ups.compressed.ok) {
    return "UPS routing fields decoded. Format 07 transport recovered, but its substitutions could not be expanded.";
  }

  const lines = ups.compressed.fields.nonEmptySegments;
  const suffix = ups.compressed.decoder.complete
    ? ""
    : "\n\nPartial result: the final compressed bits do not form another complete token.";
  return `UPS Format 07\n${lines.join("\n")}${suffix}`;
}

function fitContain(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  if (!sourceWidth || !sourceHeight || !targetWidth || !targetHeight) {
    return { x: 0, y: 0, width: targetWidth, height: targetHeight, scale: 1 };
  }
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
    scale,
  };
}

function fitCover(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  if (!sourceWidth || !sourceHeight || !targetWidth || !targetHeight) {
    return { x: 0, y: 0, width: targetWidth, height: targetHeight, scale: 1 };
  }
  const scale = Math.max(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height,
    scale,
  };
}

function setCanvasSize(canvas, context) {
  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const width = Math.max(1, Math.round(rect.width * dpr));
  const height = Math.max(1, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { width: rect.width, height: rect.height };
}

function drawStageBackdrop() {
  const { width, height } = setCanvasSize(els.previewCanvas, previewCtx);
  previewCtx.clearRect(0, 0, width, height);

  const gradient = previewCtx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "rgba(14, 24, 33, 0.96)");
  gradient.addColorStop(1, "rgba(7, 12, 17, 0.98)");
  previewCtx.fillStyle = gradient;
  previewCtx.fillRect(0, 0, width, height);

  previewCtx.strokeStyle = "rgba(97, 210, 255, 0.08)";
  previewCtx.lineWidth = 1;
  for (let x = 0; x < width; x += 40) {
    previewCtx.beginPath();
    previewCtx.moveTo(x, 0);
    previewCtx.lineTo(x, height);
    previewCtx.stroke();
  }
  for (let y = 0; y < height; y += 40) {
    previewCtx.beginPath();
    previewCtx.moveTo(0, y);
    previewCtx.lineTo(width, y);
    previewCtx.stroke();
  }

  const cx = width / 2;
  const cy = height / 2;
  previewCtx.strokeStyle = "rgba(97, 210, 255, 0.16)";
  previewCtx.lineWidth = 2;
  previewCtx.beginPath();
  previewCtx.arc(cx, cy, Math.min(width, height) * 0.18, 0, Math.PI * 2);
  previewCtx.stroke();

  previewCtx.strokeStyle = "rgba(247, 190, 85, 0.2)";
  previewCtx.beginPath();
  previewCtx.arc(cx, cy, Math.min(width, height) * 0.1, 0, Math.PI * 2);
  previewCtx.stroke();

}

function drawFrame(analysis = null) {
  const { width, height } = setCanvasSize(els.previewCanvas, previewCtx);
  if (!sourceCanvasHasContent()) {
    drawStageBackdrop();
    return;
  }

  previewCtx.clearRect(0, 0, width, height);
  previewCtx.fillStyle = "rgba(8, 13, 18, 0.98)";
  previewCtx.fillRect(0, 0, width, height);

  const fitFrame = state.sourceKind === "camera" ? fitCover : fitContain;
  const frame = fitFrame(els.sourceCanvas.width, els.sourceCanvas.height, width, height);
  previewCtx.drawImage(els.sourceCanvas, frame.x, frame.y, frame.width, frame.height);

  previewCtx.strokeStyle = "rgba(97, 210, 255, 0.14)";
  previewCtx.lineWidth = 1;
  previewCtx.strokeRect(frame.x, frame.y, frame.width, frame.height);

  if (analysis?.center && analysis.center.found !== false) {
    const { x, y } = analysis.center;
    const cx = frame.x + x * frame.scale;
    const cy = frame.y + y * frame.scale;
    const radius = Math.max(12, (analysis.center.radius || analysis.pitch * 5) * frame.scale);
    previewCtx.save();
    previewCtx.strokeStyle = analysis.decode?.decoded ? "rgba(97, 210, 255, 0.9)" : "rgba(247, 190, 85, 0.88)";
    previewCtx.lineWidth = 2;
    previewCtx.beginPath();
    previewCtx.arc(cx, cy, radius, 0, Math.PI * 2);
    previewCtx.stroke();
    previewCtx.beginPath();
    previewCtx.moveTo(cx - radius - 10, cy);
    previewCtx.lineTo(cx + radius + 10, cy);
    previewCtx.moveTo(cx, cy - radius - 10);
    previewCtx.lineTo(cx, cy + radius + 10);
    previewCtx.stroke();
    previewCtx.fillStyle = "rgba(232, 244, 251, 0.95)";
    previewCtx.beginPath();
    previewCtx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    previewCtx.fill();
    previewCtx.restore();
  }
}

function sourceCanvasHasContent() {
  return els.sourceCanvas.width > 0 && els.sourceCanvas.height > 0;
}

function setStatus(kind, text) {
  els.statusPill.className = "topbar-badge";
  if (kind) {
    els.statusPill.classList.add(`is-${kind}`);
  }
  els.statusPill.textContent = text;
}

function setResultPill(kind, text) {
  els.resultPill.className = "result-pill";
  if (kind) {
    els.resultPill.classList.add(`is-${kind}`);
  }
  els.resultPill.textContent = text;
}

function updateUIFromAnalysis(analysis) {
  if (!analysis) {
    setStatus("", "Idle");
    setResultPill("", "Waiting");
    els.confidenceValue.textContent = "-";
    els.sourceLabel.textContent = "No image loaded";
    els.decodedText.textContent = "Load an image to scan.";
    els.rawMessage.textContent = "-";
    updateUpsSummary(null);
    els.modeValue.textContent = "-";
    els.centerValue.textContent = "-";
    els.pitchValue.textContent = "-";
    els.bytesValue.textContent = "-";
    els.rawBytes.textContent = "-";
    els.resultNote.textContent = "Ready for an image.";
    els.idleState.hidden = false;
    drawStageBackdrop();
    return;
  }

  const confidencePct = Math.round((analysis.confidence ?? 0) * 1000) / 10;
  const statusKind = analysis.decode?.decoded ? "live" : confidencePct >= 65 ? "warn" : "bad";
  const pillText = analysis.decode?.decoded ? "Decoded" : "Analyzed";
  const statusText = analysis.decode?.decoded
    ? state.phase === "decoded" ? "Decoded · paused" : "Decoded"
    : state.cameraActive ? "Camera live" : pillText;

  setStatus(statusKind, statusText);
  setResultPill(statusKind, pillText);
  els.confidenceValue.textContent = `${confidencePct}% confidence`;
  els.sourceLabel.textContent = state.sourceName || `${analysis.sourceWidth} x ${analysis.sourceHeight}`;
  updateUpsSummary(analysis.ups);
  if (analysis.ups?.recognized) {
    els.decodedText.textContent = [
      "Raw MaxiCode message",
      visibleControls(analysis.decode.text),
      "",
      "UPS interpretation",
      formatUpsResult(analysis.ups),
    ].join("\n");
  } else {
    els.decodedText.textContent = analysis.decode?.text
      ? visibleControls(analysis.decode.text)
      : analysis.decode?.error || "No readable payload found.";
  }
  els.rawMessage.textContent = analysis.decode?.text ? visibleControls(analysis.decode.text) : "-";
  const rotation = Math.round((analysis.decode?.rotation || 0) * 10) / 10;
  els.modeValue.textContent = analysis.decode?.mode
    ? `Mode ${analysis.decode.mode} · ${rotation}°`
    : analysis.decode?.modeGuess || "-";
  els.centerValue.textContent = analysis.center.found
    ? `${analysis.center.x.toFixed(1)}, ${analysis.center.y.toFixed(1)}`
    : "Not found";
  els.pitchValue.textContent = `${analysis.pitch.toFixed(2)} px`;
  els.bytesValue.textContent = analysis.decode?.bytes?.length ? `${analysis.decode.bytes.length}` : "-";
  els.rawBytes.textContent = analysis.decode?.bytes?.length
    ? analysis.decode.bytes
        .map((byte, index) => `${index.toString(16).padStart(2, "0")} ${byte.toString(16).padStart(2, "0")}`)
        .join("  ")
    : "-";
  const thresholdNote = analysis.threshold !== AUTO_THRESHOLD_CANDIDATES[0]
    ? ` Auto-selected threshold ${analysis.threshold}.`
    : "";
  els.resultNote.textContent = (analysis.decode?.decoded
    ? state.phase === "decoded" && analysis.sourceKind === "camera"
      ? `Decoded locally. The successful camera frame is frozen (${analysis.sourceWidth} x ${analysis.sourceHeight}).`
      : `Decoded locally in the browser. Source: ${analysis.sourceWidth} x ${analysis.sourceHeight}.`
    : analysis.center.found
      ? analysis.decode?.error || "Bullseye found, but the payload is not fully readable yet."
      : "No MaxiCode bullseye found in this frame.") + thresholdNote;
  els.idleState.hidden = true;
  drawFrame(analysis);
}

function scanSource() {
  if (!sourceCanvasHasContent()) {
    state.analysis = null;
    updateUIFromAnalysis(null);
    return null;
  }

  const imageData = sourceCtx.getImageData(0, 0, els.sourceCanvas.width, els.sourceCanvas.height);
  const thresholds = state.sourceKind === "camera"
    ? [AUTO_THRESHOLD_CANDIDATES[state.thresholdAttempt % AUTO_THRESHOLD_CANDIDATES.length]]
    : AUTO_THRESHOLD_CANDIDATES;
  state.thresholdAttempt += 1;
  const { center, pitch, cells, decode, threshold, attempts } = scanWithThresholds(imageData, {
    thresholds,
  });
  let ups = null;
  if (decode.decoded && decode.text) {
    try {
      ups = upsReader.read(decode.text);
    } catch (error) {
      ups = { recognized: false, error: error?.message || String(error) };
    }
  }
  const confidence = decode.decoded
    ? clamp(0.72 + center.confidence * 0.28, 0, 1)
    : clamp(center.confidence * 0.72 + decode.density * 0.2, 0, 1);

  const analysis = {
    center,
    pitch,
    cells,
    decode,
    threshold,
    thresholdAttempts: attempts,
    ups,
    confidence,
    sourceKind: state.sourceKind,
    sourceName: state.sourceName,
    sourceWidth: els.sourceCanvas.width,
    sourceHeight: els.sourceCanvas.height,
  };

  state.analysis = analysis;
  if (decode.decoded && state.phase !== "decoded") {
    lockSuccessfulDecode();
  }
  updateUIFromAnalysis(analysis);
  return analysis;
}

async function loadFile(file) {
  if (!file) return;
  stopCamera();
  state.phase = "analyzing";
  state.sourceKind = "image";
  state.sourceName = file.name || "Loaded image";
  state.thresholdAttempt = 0;

  const drawable = await loadDrawable(file);
  els.sourceCanvas.width = drawable.width;
  els.sourceCanvas.height = drawable.height;
  sourceCtx.clearRect(0, 0, drawable.width, drawable.height);
  sourceCtx.drawImage(drawable, 0, 0);

  if (typeof drawable.close === "function") {
    drawable.close();
  }

  scanSource();
}

function loadDrawable(file) {
  if ("createImageBitmap" in window) {
    return createImageBitmap(file).catch(() => loadImageElement(file));
  }
  return loadImageElement(file);
}

async function pasteFromClipboard() {
  if (!navigator.clipboard?.read) {
    setStatus("warn", "Use Ctrl+V");
    els.resultNote.textContent = "Clipboard image reading is not supported here. Try Ctrl+V instead.";
    return false;
  }

  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find((type) => type.startsWith("image/"));
      if (!imageType) continue;
      const blob = await item.getType(imageType);
      const file = new File([blob], "clipboard-image.png", { type: blob.type || imageType });
      await loadFile(file);
      return true;
    }
  } catch {
    // fall through to the hint below
  }

  setStatus("warn", "Use Ctrl+V");
  els.resultNote.textContent = "Press Ctrl+V after copying an image, or upload a file instead.";
  return false;
}

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load image"));
    };
    image.src = url;
  });
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("bad", "Camera unavailable");
    els.resultNote.textContent = "This browser does not expose a camera stream.";
    return;
  }

  stopCamera();
  state.phase = "starting";

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
      },
      audio: false,
    });

    state.stream = stream;
    state.cameraActive = true;
    state.phase = "scanning";
    state.sourceKind = "camera";
    state.sourceName = "Live camera";
    state.thresholdAttempt = 0;
    els.cameraVideo.srcObject = stream;
    await els.cameraVideo.play();

    await captureCameraFrame();
    if (state.phase === "scanning") {
      state.scanTimer = window.setInterval(() => {
        if (!state.captureInFlight && state.phase === "scanning") {
          captureCameraFrame().catch(() => {});
        }
      }, 550);
    }
    updateCameraButton();
  } catch (error) {
    state.phase = "error";
    stopCamera({ keepPhase: true });
    setStatus("bad", "Camera blocked");
    els.resultNote.textContent = error?.message || "Could not open the camera.";
  }
}

async function captureCameraFrame() {
  if (
    !state.cameraActive
    || state.phase !== "scanning"
    || state.captureInFlight
    || !els.cameraVideo.videoWidth
    || !els.cameraVideo.videoHeight
  ) {
    return;
  }

  state.captureInFlight = true;
  try {
    const maxScanDimension = 960;
    const cameraScale = Math.min(
      1,
      maxScanDimension / Math.max(els.cameraVideo.videoWidth, els.cameraVideo.videoHeight),
    );
    els.sourceCanvas.width = Math.max(1, Math.round(els.cameraVideo.videoWidth * cameraScale));
    els.sourceCanvas.height = Math.max(1, Math.round(els.cameraVideo.videoHeight * cameraScale));
    sourceCtx.drawImage(els.cameraVideo, 0, 0, els.sourceCanvas.width, els.sourceCanvas.height);
    scanSource();
  } finally {
    state.captureInFlight = false;
  }
}

function lockSuccessfulDecode() {
  state.phase = "decoded";
  stopCamera({ keepPhase: true });
}

function stopCamera({ keepPhase = false } = {}) {
  if (state.scanTimer) {
    window.clearInterval(state.scanTimer);
    state.scanTimer = null;
  }
  if (state.stream) {
    for (const track of state.stream.getTracks()) {
      track.stop();
    }
  }
  state.stream = null;
  state.cameraActive = false;
  els.cameraVideo.pause();
  els.cameraVideo.srcObject = null;
  if (!keepPhase && state.phase === "scanning") {
    state.phase = "stopped";
  }
  updateCameraButton();
}

function updateCameraButton() {
  els.cameraBtnLabel.textContent = state.cameraActive
    ? "Stop"
    : state.phase === "decoded" && state.sourceKind === "camera" ? "Scan again" : "Camera";
  document.body.classList.toggle("is-camera-active", state.cameraActive);
  document.body.classList.toggle("is-scan-complete", state.phase === "decoded");
}

function setResultExpanded(expanded) {
  els.resultPanel.classList.toggle("is-expanded", expanded);
  document.body.classList.toggle("is-result-expanded", expanded);
  els.resultToggle.setAttribute("aria-expanded", String(expanded));
  els.resultToggle.textContent = expanded ? "Close" : "Details";
}

function clearState() {
  stopCamera();
  state.phase = "idle";
  state.captureInFlight = false;
  state.sourceKind = "idle";
  state.sourceName = "";
  state.analysis = null;
  state.thresholdAttempt = 0;
  els.sourceCanvas.width = 0;
  els.sourceCanvas.height = 0;
  els.fileInput.value = "";
  setResultExpanded(false);
  updateUIFromAnalysis(null);
}

async function handlePaste(event) {
  const items = event.clipboardData?.items || [];
  for (const item of items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    if (file && file.type.startsWith("image/")) {
      await loadFile(file);
      return true;
    }
  }
  return false;
}

async function copyResult() {
  const text = state.analysis?.decode?.text;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    setStatus("live", "Copied");
    els.resultNote.textContent = "Decoded text copied to clipboard.";
  } catch {
    setStatus("warn", "Copy failed");
    els.resultNote.textContent = "Clipboard access was blocked by the browser.";
  }
}

function wireEvents() {
  els.uploadBtn.addEventListener("click", () => els.fileInput.click());
  els.fileInput.addEventListener("change", async () => {
    const [file] = els.fileInput.files || [];
    if (file) {
      await loadFile(file);
    }
  });

  els.pasteBtn.addEventListener("click", async () => {
    await pasteFromClipboard();
  });

  els.cameraBtn.addEventListener("click", async () => {
    if (state.cameraActive) {
      stopCamera();
      setStatus("", "Idle");
      els.resultNote.textContent = "Camera stopped.";
      drawFrame(state.analysis);
      return;
    }
    state.phase = "idle";
    await startCamera();
  });

  els.clearBtn.addEventListener("click", clearState);
  els.copyBtn.addEventListener("click", copyResult);
  els.resultToggle.addEventListener("click", () => {
    setResultExpanded(!els.resultPanel.classList.contains("is-expanded"));
  });

  document.addEventListener("paste", async (event) => {
    const handled = await handlePaste(event);
    if (!handled && event.clipboardData?.getData("text/plain")) {
      setStatus("warn", "Paste image");
      els.resultNote.textContent = "The clipboard contains text, not an image.";
    }
  });

  const prevent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  ["dragenter", "dragover", "dragleave", "drop"].forEach((type) => {
    els.dropzone.addEventListener(type, prevent);
  });

  els.dropzone.addEventListener("dragover", () => {
    els.dropzone.classList.add("is-dragging");
  });
  els.dropzone.addEventListener("dragleave", () => {
    els.dropzone.classList.remove("is-dragging");
  });
  els.dropzone.addEventListener("drop", async (event) => {
    els.dropzone.classList.remove("is-dragging");
    const [file] = event.dataTransfer?.files || [];
    if (file) {
      await loadFile(file);
    }
  });

  window.addEventListener("resize", () => drawFrame(state.analysis));
}

function updateInitialUI() {
  setStatus("", "Idle");
  setResultPill("", "Waiting");
  els.resultNote.textContent = "Ready for an image.";
  setResultExpanded(false);
  updateCameraButton();
  drawStageBackdrop();
}

wireEvents();
updateInitialUI();
