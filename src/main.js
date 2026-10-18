import { PreviewEngine, stageRect, titleBox, visualBox } from "./engine.js";
import { availableFormats } from "./formats.js";
import { remixPresets } from "./presets.js";
import { findSilence, makeFilmstrip, makeWaveform } from "./filmstrip.js";
import {
  addMedia,
  arrangeVisuals,
  createProject,
  deleteSelected,
  detachAudio,
  duplicateSelected,
  findClip,
  fitClip,
  formatTime,
  makeClip,
  makeWavTone,
  moveClipToTrack,
  moveClip,
  neighborEnd,
  neighborStart,
  placeClip,
  projectEnd,
  setSpeed,
  sourceLimit,
  splitScreen,
  splitSelected,
  trackForMedia,
  trimLeft,
  trimRight,
} from "./model.js";
import "./style.css";

const project = createProject();
const engine = new PreviewEngine(document.querySelector("#preview"));
const undoStack = [];
const redoStack = [];

const mediaList = document.querySelector("#media-list");
const tracksEl = document.querySelector("#tracks");
const ruler = document.querySelector("#ruler");
const playhead = document.querySelector("#playhead");
const inspector = document.querySelector("#inspector");
const timecode = document.querySelector("#timecode");
const status = document.querySelector("#status");
const playBtn = document.querySelector("#play-btn");
const fileInput = document.querySelector("#file-input");
const zoom = document.querySelector("#zoom");
const totalTime = document.querySelector("#total-time");
const exportBar = document.querySelector("#export-bar");
const projectName = document.querySelector("#project-name");
const timeline = document.querySelector("#timeline-scroll");
let followPlayhead = true;

engine.onSeeked = () => refreshPreview();

function mediaMap() {
  return new Map(project.media.map((media) => [media.id, media]));
}

function limitFor(clip) {
  return sourceLimit(project.media.find((media) => media.id === clip.mediaId));
}

function snapshot() {
  return JSON.stringify({
    tracks: project.tracks,
    playhead: project.playhead,
    selectedClipId: project.selectedClipId,
    markers: project.markers,
    loop: project.loop,
    guides: project.guides,
    aspect: project.aspect,
  });
}

function restore(json) {
  const data = JSON.parse(json);
  project.tracks = data.tracks;
  project.playhead = data.playhead;
  project.selectedClipId = data.selectedClipId;
  project.markers = data.markers || [];
  project.loop = Boolean(data.loop);
  project.guides = Boolean(data.guides);
  if (data.aspect) project.aspect = data.aspect;
  inspector.dataset.signature = "";
  render();
}

function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > 50) undoStack.shift();
  redoStack.length = 0;
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push(snapshot());
  restore(undoStack.pop());
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
}

function span() {
  return Math.max(20, projectEnd(project) + 8);
}

function timeAt(event) {
  const rect = ruler.getBoundingClientRect();
  return Math.max(0, (event.clientX - rect.left) / project.pxPerSec);
}

function refreshPreview() {
  engine.sync(project, mediaMap(), project.playhead, engine.playing);
  engine.render(project, mediaMap(), project.playhead);
  playhead.style.left = `${84 + project.playhead * project.pxPerSec}px`;
  timecode.textContent = formatTime(project.playhead);
  const hasClips = project.tracks.some((track) => track.clips.length);
  totalTime.textContent = `/ ${formatTime(hasClips ? projectEnd(project) : 0)}`;
  if (followPlayhead && engine.playing) revealPlayhead();
}

function revealPlayhead() {
  const x = 84 + project.playhead * project.pxPerSec;
  const left = timeline.scrollLeft;
  const right = left + timeline.clientWidth;
  if (x < left + 120 || x > right - 64) timeline.scrollLeft = Math.max(0, x - timeline.clientWidth * 0.35);
}

function fitTimeline() {
  const seconds = Math.max(projectEnd(project) + 1, 8);
  const available = Math.max(240, timeline.clientWidth - 110);
  project.pxPerSec = Math.min(160, Math.max(8, available / seconds));
  zoom.value = String(Math.round(project.pxPerSec));
}

function seek(time) {
  engine.pause();
  playBtn.textContent = "Play";
  project.playhead = Math.max(0, time);
  refreshPreview();
}

function render() {
  renderMedia();
  renderTimeline();
  renderInspector();
  syncToggles();
  refreshPreview();
}

function syncToggles() {
  document.querySelector("#loop-btn").classList.toggle("on", project.loop);
  document.querySelector("#guides-btn").classList.toggle("on", project.guides);
}

function renderMedia() {
  if (!project.media.length) {
    mediaList.innerHTML = "";
    const item = document.createElement("li");
    item.className = "empty";
    item.textContent = "Import video, audio, or images. Matte, title, and tone are built in.";
    mediaList.append(item);
    return;
  }
  mediaList.replaceChildren(
    ...project.media.map((media) => {
      const item = document.createElement("li");
      item.className = "media-item";
      const title = document.createElement("strong");
      title.textContent = media.name;
      const meta = document.createElement("small");
      meta.textContent = `${media.kind} · ${formatTime(media.duration || 0)}`;
      item.append(title, meta);
      item.addEventListener("click", () => addExistingMedia(media));
      return item;
    }),
  );
}

function renderTimeline() {
  const width = span() * project.pxPerSec;
  const step = project.pxPerSec >= 64 ? 1 : project.pxPerSec >= 28 ? 5 : 10;
  ruler.style.width = `${width}px`;
  ruler.replaceChildren();
  for (let second = 0; second <= span(); second += step) {
    const tick = document.createElement("div");
    tick.className = "tick";
    tick.style.left = `${second * project.pxPerSec}px`;
    tick.textContent = formatTime(second).slice(0, 5);
    ruler.append(tick);
  }
  for (const time of project.markers) {
    const marker = document.createElement("div");
    marker.className = "marker";
    marker.dataset.time = String(time);
    marker.style.left = `${time * project.pxPerSec}px`;
    marker.title = formatTime(time);
    ruler.append(marker);
  }
  tracksEl.replaceChildren(
    ...project.tracks.map((track) => {
      const row = document.createElement("div");
      row.className = "track";
      const label = document.createElement("div");
      label.className = "track-label";
      const name = document.createElement("span");
      name.textContent = track.name;
      const mute = document.createElement("button");
      mute.type = "button";
      mute.className = `mute${track.muted ? " on" : ""}`;
      mute.textContent = track.muted ? "Muted" : "Mute";
      mute.title = track.muted ? "Unmute track" : "Mute track";
      mute.addEventListener("click", (event) => {
        event.stopPropagation();
        pushUndo();
        track.muted = !track.muted;
        render();
      });
      label.append(name, mute);
      const lane = document.createElement("div");
      lane.className = "lane";
      lane.style.width = `${width}px`;
      lane.dataset.track = track.id;
      for (const clip of track.clips) {
        const element = document.createElement("div");
        element.className = `clip ${track.type}${clip.id === project.selectedClipId ? " selected" : ""}`;
        element.dataset.id = clip.id;
        element.style.left = `${clip.start * project.pxPerSec}px`;
        element.style.width = `${Math.max(12, clip.duration * project.pxPerSec)}px`;
        const name = document.createElement("span");
        const media = project.media.find((item) => item.id === clip.mediaId);
        name.textContent = track.type === "title" ? clip.text : media?.name || "Clip";
        const meta = document.createElement("small");
        meta.textContent = formatTime(clip.duration);
        paintClipFace(element, clip, media, track);
        element.append(name, meta);
        lane.append(element);
      }
      row.append(label, lane);
      return row;
    }),
  );
}

function paintClipFace(element, clip, media, track) {
  const art = track.type === "audio" ? media?.waveform : media?.filmstrip;
  if (!art) return;
  const speed = clip.speed || 1;
  const full = ((media.duration || clip.duration) / speed) * project.pxPerSec;
  const shift = (clip.inPoint / speed) * project.pxPerSec;
  element.style.backgroundImage = `linear-gradient(90deg, rgba(0,0,0,.55), rgba(0,0,0,.12) 42%), url("${art}")`;
  element.style.backgroundSize = `auto, ${full}px 100%`;
  element.style.backgroundPosition = `0 0, ${-shift}px center`;
  element.style.backgroundRepeat = "no-repeat";
}

function inspectorSignature() {
  const found = findClip(project, project.selectedClipId);
  if (!found) return "";
  const clip = found.clip;
  return [
    clip.id,
    clip.start.toFixed(3),
    clip.duration.toFixed(3),
    clip.inPoint.toFixed(3),
    clip.speed,
    clip.x,
    clip.y,
    clip.scale,
    clip.text,
  ].join("|");
}

function renderInspector() {
  const signature = inspectorSignature();
  if (inspector.dataset.signature === signature) return;
  inspector.dataset.signature = signature;
  inspector.replaceChildren();
  const found = findClip(project, project.selectedClipId);
  if (!found) {
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = "Select a clip for looks, motion, blend, shape, and title style.";
    inspector.append(hint);
    return;
  }
  const { track, clip } = found;
  const media = project.media.find((item) => item.id === clip.mediaId);
  const fields = [
    heading("Timing"),
    numberField("Start", clip.start, 0.1, (value) => {
      moveClip(clip, value);
    }),
    numberField("Duration", clip.duration, 0.1, (value) => trimRight(clip, value, limitFor(clip))),
    numberField("Speed", clip.speed, 0.05, (value) => setSpeed(clip, value, limitFor(clip)), 0.25, 4),
  ];
  if (track.type !== "title") {
    fields.push(rangeField("Volume", clip.volume, 0, 1, 0.01, (value) => { clip.volume = value; }));
  }
  if (track.type !== "audio") {
    fields.push(heading("Picture"),
      selectField("Look", clip.look || "none", [
        ["none", "None"],
        ["warm", "Warm"],
        ["cool", "Cool"],
        ["mono", "Mono"],
        ["punch", "Punch"],
        ["fade", "Fade"],
        ["noir", "Noir"],
      ], (value) => { clip.look = value; }),
      rangeField("Temperature", clip.temperature || 0, -1, 1, 0.05, (value) => { clip.temperature = value; }),
      checkField("Chroma key", clip.chromaEnabled, (value) => { clip.chromaEnabled = value; }),
      colorField("Key color", clip.chroma || "#00ff00", (value) => { clip.chroma = value; }),
      rangeField("Key amount", clip.chromaAmount ?? 0.45, 0, 1, 0.01, (value) => { clip.chromaAmount = value; }),
      selectField("Effect", clip.effect || "none", [["none", "None"], ["grain", "Grain"]], (value) => { clip.effect = value; }),
    );
  }
  if (media?.kind === "video") {
    fields.push(numberField("Speed end", clip.speedEnd ?? clip.speed, 0.05, (value) => { clip.speedEnd = value; }, 0.25, 4));
  }
  if (track.type === "audio") {
    fields.push(
      checkField("Duck under picture", clip.duck, (value) => { clip.duck = value; }),
      checkField("Noise gate", clip.gate, (value) => { clip.gate = value; }),
      checkField("Center cancel", clip.vocal, (value) => { clip.vocal = value; }),
    );
  }
  if (track.type !== "audio") {
    fields.push(
      rangeField("Opacity", clip.opacity, 0, 1, 0.01, (value) => { clip.opacity = value; }),
      rangeField("Fade in", clip.fadeIn, 0, 3, 0.05, (value) => { clip.fadeIn = value; }),
      rangeField("Fade out", clip.fadeOut, 0, 3, 0.05, (value) => { clip.fadeOut = value; }),
      rangeField("Brightness", clip.brightness, 0, 2, 0.01, (value) => { clip.brightness = value; }),
      rangeField("Contrast", clip.contrast, 0, 2, 0.01, (value) => { clip.contrast = value; }),
      rangeField("Saturation", clip.saturate, 0, 2, 0.01, (value) => { clip.saturate = value; }),
      rangeField("Blur", clip.blur || 0, 0, 24, 0.5, (value) => { clip.blur = value; }),
      numberField("Rotate", clip.rotate || 0, 1, (value) => { clip.rotate = value; }, -180, 180),
      checkField("Flip", clip.flip, (value) => { clip.flip = value; }),
      checkField("Ken Burns", clip.kenBurns, (value) => { clip.kenBurns = value; }),
      checkField("Vignette", clip.vignette, (value) => { clip.vignette = value; }),
      selectField("Shape", clip.shape || "rect", [["rect", "Rectangle"], ["circle", "Circle"]], (value) => { clip.shape = value; }),
    );
  }
  if (track.type !== "audio") {
    fields.push(heading("Place"));
    fields.push(selectField("Blend", clip.blend || "source-over", [
      ["source-over", "Normal"],
      ["multiply", "Multiply"],
      ["screen", "Screen"],
      ["overlay", "Overlay"],
    ], (value) => { clip.blend = value; }));
    fields.push(
      rangeField("Scale", clip.scale ?? 1, 0.08, 3, 0.01, (value) => { fitClip(clip, clip.x ?? 0.5, clip.y ?? 0.5, value); }),
      rangeField("Horizontal", clip.x ?? 0.5, -0.5, 1.5, 0.01, (value) => { fitClip(clip, value, clip.y ?? 0.5, clip.scale ?? 1); }),
      rangeField("Vertical", clip.y ?? 0.5, -0.5, 1.5, 0.01, (value) => { fitClip(clip, clip.x ?? 0.5, value, clip.scale ?? 1); }),
    );
  }
  if (track.type === "title" || media?.kind === "color") {
    fields.push(colorField("Color", track.type === "title" ? clip.color : media.color, (value) => {
      if (track.type === "title") clip.color = value;
      else media.color = value;
    }));
  }
  if (track.type === "title") {
    fields.push(textField("Text", clip.text, (value) => { clip.text = value || "Title"; }));
    fields.push(numberField("Size", clip.fontSize, 1, (value) => { clip.fontSize = value; }, 12, 240));
    fields.push(selectField("Style", clip.titleStyle || "plain", [
      ["plain", "Plain"],
      ["lower", "Lower third"],
      ["outline", "Outline"],
      ["shadow", "Shadow"],
    ], (value) => { clip.titleStyle = value; }));
    fields.push(selectField("Motion", clip.motion || "none", [
      ["none", "None"],
      ["rise", "Rise"],
    ], (value) => { clip.motion = value; }));
  }
  if (media?.kind === "video") {
    const detach = document.createElement("button");
    detach.type = "button";
    detach.textContent = "Detach audio";
    detach.addEventListener("click", () => {
      pushUndo();
      if (!detachAudio(project)) undoStack.pop();
      render();
    });
    fields.push(detach);
  }
  inspector.append(...fields);
}

function heading(text) {
  const title = document.createElement("h3");
  title.textContent = text;
  return title;
}

function field(label, control, onInput) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const name = document.createElement("span");
  name.textContent = label;
  control.addEventListener("pointerdown", () => {
    control.dataset.undo = "1";
  });
  control.addEventListener("focus", () => {
    control.dataset.undo = "1";
  });
  control.addEventListener("input", () => {
    if (control.dataset.undo === "1") {
      pushUndo();
      control.dataset.undo = "0";
    }
    onInput(control.type === "checkbox" ? control.checked : control.type === "range" || control.type === "number" ? Number(control.value) : control.value);
    renderTimeline();
    refreshPreview();
  });
  control.addEventListener("change", () => {
    if (control.type === "checkbox" || control.tagName === "SELECT") {
      control.dispatchEvent(new Event("input"));
    }
  });
  wrap.append(name, control);
  return wrap;
}

function numberField(label, value, step, onInput, min = 0, max = 600) {
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(Math.round(value * 100) / 100);
  return field(label, input, onInput);
}

function rangeField(label, value, min, max, step, onInput) {
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  return field(label, input, onInput);
}

function colorField(label, value, onInput) {
  const input = document.createElement("input");
  input.type = "color";
  input.value = value;
  return field(label, input, onInput);
}

function textField(label, value, onInput) {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value;
  return field(label, input, onInput);
}

function selectField(label, value, options, onInput) {
  const input = document.createElement("select");
  for (const [id, text] of options) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = text;
    option.selected = id === value;
    input.append(option);
  }
  return field(label, input, onInput);
}

function checkField(label, value, onInput) {
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = Boolean(value);
  return field(label, input, onInput);
}

function snapTime(time, ignoreId) {
  const points = [project.playhead, 0];
  for (const track of project.tracks) {
    for (const clip of track.clips) {
      if (clip.id === ignoreId) continue;
      points.push(clip.start, clip.start + clip.duration);
    }
  }
  let best = time;
  let distance = 0.12;
  for (const point of points) {
    const gap = Math.abs(point - time);
    if (gap < distance) {
      distance = gap;
      best = point;
    }
  }
  return best;
}

function addExistingMedia(media) {
  pushUndo();
  const track = trackForMedia(project, media);
  const duration = Math.min(media.duration || 5, 30);
  placeClip(project, track, makeClip({
    mediaId: media.id,
    start: project.playhead,
    duration,
    fadeIn: track.type === "video" ? 0 : 0.2,
    fadeOut: track.type === "video" ? 0 : 0.3,
  }));
  render();
}

function addColor() {
  pushUndo();
  const media = addMedia(project, {
    id: crypto.randomUUID(),
    kind: "color",
    name: "Matte",
    color: "#e07a45",
    duration: 5,
  });
  placeClip(project, trackForMedia(project, media), makeClip({
    mediaId: media.id,
    start: project.playhead,
    duration: 5,
    fadeIn: 0,
    fadeOut: 0,
  }));
  render();
}

function addTitle() {
  pushUndo();
  const track = project.tracks.find((item) => item.id === "title");
  placeClip(project, track, makeClip({
    start: project.playhead,
    duration: 3,
    text: "Title",
    y: 0.78,
    fadeIn: 0.25,
    fadeOut: 0.35,
    motion: "rise",
  }));
  render();
}

function addLowerThird() {
  pushUndo();
  const track = project.tracks.find((item) => item.id === "title");
  placeClip(project, track, makeClip({
    start: project.playhead,
    duration: 4,
    text: "Lower third",
    y: 0.84,
    fontSize: 42,
    fadeIn: 0.3,
    fadeOut: 0.35,
    titleStyle: "lower",
    motion: "rise",
  }));
  render();
}

function addTone() {
  pushUndo();
  const media = addMedia(project, {
    id: crypto.randomUUID(),
    kind: "tone",
    name: "Tone",
    url: makeWavTone(8),
    duration: 8,
  });
  placeClip(project, trackForMedia(project, media), makeClip({
    mediaId: media.id,
    start: project.playhead,
    duration: 4,
    fadeIn: 0,
    fadeOut: 0,
    volume: 0.4,
  }));
  render();
}

function kindFor(file) {
  if (file.type.startsWith("audio")) return "audio";
  if (file.type.startsWith("image")) return "image";
  if (file.type.startsWith("video")) return "video";
  const name = file.name.toLowerCase();
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(name)) return "audio";
  if (/\.(png|jpe?g|gif|webp|bmp)$/.test(name)) return "image";
  return "video";
}

async function enrich(media) {
  try {
    if (media.kind === "image") {
      const image = new Image();
      image.src = media.url;
      await image.decode();
      media.width = image.naturalWidth;
      media.height = image.naturalHeight;
      const thumb = document.createElement("canvas");
      thumb.width = 160;
      thumb.height = 90;
      const ctx = thumb.getContext("2d");
      const scale = Math.max(thumb.width / image.naturalWidth, thumb.height / image.naturalHeight);
      const dw = image.naturalWidth * scale;
      const dh = image.naturalHeight * scale;
      ctx.drawImage(image, (thumb.width - dw) / 2, (thumb.height - dh) / 2, dw, dh);
      media.filmstrip = thumb.toDataURL("image/jpeg", 0.72);
    }
    if (media.kind === "video") {
      const strip = await makeFilmstrip(media.url, media.duration);
      media.filmstrip = strip.url;
      if (strip.width) {
        media.width = strip.width;
        media.height = strip.height;
      }
    }
    if (media.kind === "video" || media.kind === "audio" || media.kind === "tone") {
      media.waveform = await makeWaveform(media.url);
    }
  } catch {
    media.filmstrip = media.filmstrip || null;
  }
  renderTimeline();
}

async function importFiles(files) {
  pushUndo();
  let imported = 0;
  for (const file of files) {
    const kind = kindFor(file);
    const url = URL.createObjectURL(file);
    const duration = await probe(url, kind);
    if (!duration) {
      status.textContent = `Could not read ${file.name}`;
      continue;
    }
    const media = addMedia(project, {
      id: crypto.randomUUID(),
      kind,
      name: file.name,
      url,
      duration,
    });
    const track = trackForMedia(project, media);
    const still = kind === "image";
    const fade = 0.45;
    const occupied = track.clips.reduce((end, clip) => Math.max(end, clip.start + clip.duration), 0);
    const start = track.type === "audio"
      ? Math.max(0, project.playhead)
      : still && occupied > 0 ? Math.max(0, occupied - fade) : Math.max(project.playhead, occupied);
    placeClip(project, track, makeClip({
      mediaId: media.id,
      start,
      duration: still ? 4 : duration,
      fadeIn: still ? fade : 0,
      fadeOut: still ? fade : 0,
      crossfade: still ? fade : 0,
      kenBurns: still,
    }));
    if (project.name === "Untitled") {
      project.name = file.name.replace(/\.[^.]+$/, "");
      projectName.textContent = project.name;
    }
    imported += 1;
    void enrich(media);
  }
  if (!imported) {
    undoStack.pop();
    return;
  }
  fitTimeline();
  render();
  status.textContent = `Imported ${imported} file${imported === 1 ? "" : "s"}`;
}

function probe(url, kind) {
  if (kind === "image") return Promise.resolve(4);
  return new Promise((resolve) => {
    const element = document.createElement(kind === "audio" ? "audio" : "video");
    element.preload = "auto";
    element.src = url;
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      element.onloadedmetadata = null;
      element.ondurationchange = null;
      element.onseeked = null;
      element.onerror = null;
      element.removeAttribute("src");
      element.load();
      resolve(value > 0.05 ? value : 0);
    };
    element.onerror = () => finish(0);
    element.onloadedmetadata = () => {
      if (Number.isFinite(element.duration) && element.duration > 0) {
        finish(element.duration);
        return;
      }
      const check = () => {
        if (Number.isFinite(element.duration) && element.duration > 0) finish(element.duration);
      };
      element.ondurationchange = check;
      element.onseeked = check;
      try {
        element.currentTime = 1e101;
      } catch {
        finish(0);
      }
    };
    setTimeout(() => finish(Number.isFinite(element.duration) ? element.duration : 0), 2000);
  });
}

function togglePlay() {
  if (engine.playing) {
    engine.pause();
    playBtn.textContent = "Play";
    return;
  }
  if (project.playhead >= projectEnd(project) - 0.05) project.playhead = 0;
  followPlayhead = true;
  playBtn.textContent = "Pause";
  engine.play(project, mediaMap(), {
    get: () => project.playhead,
    set: (time) => {
      project.playhead = time;
      playhead.style.left = `${84 + time * project.pxPerSec}px`;
      timecode.textContent = formatTime(time);
      if (followPlayhead) revealPlayhead();
    },
    stopped: () => {
      playBtn.textContent = "Play";
    },
  });
}

document.querySelector("#import-btn").addEventListener("click", () => fileInput.click());
function addGrade() {
  pushUndo();
  const track = project.tracks.find((item) => item.id === "grade");
  const end = projectEnd(project);
  placeClip(project, track, makeClip({
    start: 0,
    duration: end > 0.2 ? end : 5,
    look: "mono",
    fadeIn: 0,
    fadeOut: 0,
  }));
  render();
  status.textContent = "Grade layer added";
}

function sideBySide() {
  pushUndo();
  if (!splitScreen(project)) {
    undoStack.pop();
    status.textContent = "Add two pictures or videos, then split the screen";
    return;
  }
  render();
  status.textContent = "Split screen";
}

function captureThumbnail() {
  document.querySelector("#preview").toBlob((blob) => {
    if (!blob) return;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${(project.name || "reel").replace(/[^\w.-]+/g, "-")}-thumbnail.png`;
    link.click();
    status.textContent = `Saved ${link.download}`;
  }, "image/png");
}

async function markSilence() {
  const found = findClip(project, project.selectedClipId);
  const media = found && project.media.find((item) => item.id === found.clip.mediaId);
  if (!media?.url) {
    status.textContent = "Select an audio clip to find silence";
    return;
  }
  const marks = await findSilence(media.url);
  if (!marks.length) {
    status.textContent = "No silence found";
    return;
  }
  pushUndo();
  for (const mark of marks) {
    const time = found.clip.start + mark;
    if (!project.markers.some((item) => Math.abs(item - time) < 0.08)) project.markers.push(time);
  }
  project.markers.sort((a, b) => a - b);
  render();
  status.textContent = `${marks.length} silent region${marks.length === 1 ? "" : "s"} marked`;
}

async function recordScreen() {
  if (!navigator.mediaDevices?.getDisplayMedia) {
    status.textContent = "This browser cannot record the screen";
    return;
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
  } catch {
    status.textContent = "Screen recording was cancelled";
    return;
  }
  const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
  const recorder = new MediaRecorder(stream, { mimeType: mime });
  const chunks = [];
  recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
  const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
  recorder.start(200);
  status.textContent = "Recording screen. Stop sharing to finish.";
  stream.getVideoTracks()[0].addEventListener("ended", () => {
    if (recorder.state === "recording") recorder.stop();
  });
  await stopped;
  stream.getTracks().forEach((track) => track.stop());
  const blob = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
  if (!blob.size) {
    status.textContent = "Screen recording was empty";
    return;
  }
  await importFiles([new File([blob], "Screen recording.webm", { type: blob.type })]);
}

document.querySelector("#aspect").addEventListener("change", (event) => {
  pushUndo();
  project.aspect = event.target.value;
  render();
  status.textContent = `Frame ${project.aspect}`;
});
document.querySelector("#grade-btn").addEventListener("click", addGrade);
document.querySelector("#split-screen-btn").addEventListener("click", sideBySide);
document.querySelector("#arrange").addEventListener("change", (event) => {
  const mode = event.target.value;
  if (!mode) return;
  pushUndo();
  if (!arrangeVisuals(project, mode)) {
    undoStack.pop();
    status.textContent = "Add a picture and a video, then arrange them";
    event.target.value = "";
    return;
  }
  inspector.dataset.signature = "";
  render();
  const labels = {
    sequence: "Sequence",
    "picture-over": "Picture over video",
    "video-over": "Video over picture",
    side: "Side by side",
  };
  status.textContent = labels[mode];
});
document.querySelector("#thumb-btn").addEventListener("click", captureThumbnail);
document.querySelector("#silence-btn").addEventListener("click", () => { void markSilence(); });
document.querySelector("#record-btn").addEventListener("click", () => { void recordScreen(); });
document.querySelector("#matte-btn").addEventListener("click", addColor);
document.querySelector("#title-btn").addEventListener("click", addTitle);
document.querySelector("#tone-btn").addEventListener("click", addTone);
document.querySelector("#lower-btn").addEventListener("click", addLowerThird);
document.querySelector("#duplicate-btn").addEventListener("click", () => {
  pushUndo();
  if (!duplicateSelected(project)) {
    undoStack.pop();
    status.textContent = "Select a clip to duplicate.";
    return;
  }
  render();
});
document.querySelector("#marker-btn").addEventListener("click", () => {
  if (project.markers.some((time) => Math.abs(time - project.playhead) < 0.08)) return;
  pushUndo();
  project.markers.push(project.playhead);
  project.markers.sort((a, b) => a - b);
  render();
});
document.querySelector("#loop-btn").addEventListener("click", () => {
  project.loop = !project.loop;
  syncToggles();
  status.textContent = project.loop ? "Loop is on" : "Loop is off";
});
document.querySelector("#guides-btn").addEventListener("click", () => {
  project.guides = !project.guides;
  syncToggles();
  refreshPreview();
});
document.querySelector("#split-btn").addEventListener("click", () => {
  pushUndo();
  if (!splitSelected(project)) {
    undoStack.pop();
    status.textContent = "Move the playhead inside a selected clip, then split.";
    return;
  }
  render();
});
document.querySelector("#delete-btn").addEventListener("click", () => {
  pushUndo();
  if (!deleteSelected(project)) undoStack.pop();
  render();
});
document.querySelector("#undo-btn").addEventListener("click", undo);
document.querySelector("#redo-btn").addEventListener("click", redo);
const exportSize = document.querySelector("#export-size");
const exportFormat = document.querySelector("#export-format");
const formats = availableFormats();
for (const format of formats) {
  const option = document.createElement("option");
  option.value = format.id;
  option.textContent = format.label;
  exportFormat.append(option);
}
const savedSize = localStorage.getItem("reel-export-size");
if (savedSize && [...exportSize.options].some((option) => option.value === savedSize)) exportSize.value = savedSize;
exportSize.addEventListener("change", () => localStorage.setItem("reel-export-size", exportSize.value));
const savedFormat = localStorage.getItem("reel-export-format");
if (savedFormat && formats.some((format) => format.id === savedFormat)) exportFormat.value = savedFormat;
exportFormat.addEventListener("change", () => localStorage.setItem("reel-export-format", exportFormat.value));

const remixSelect = document.querySelector("#remix");
const remixPlaceholder = document.createElement("option");
remixPlaceholder.value = "";
remixPlaceholder.textContent = "Remix";
remixSelect.append(remixPlaceholder);
for (const preset of remixPresets) {
  const option = document.createElement("option");
  option.value = preset.id;
  option.textContent = preset.name;
  remixSelect.append(option);
}

function remixTargets(all) {
  const preset = remixPresets.find((item) => item.id === remixSelect.value);
  if (!preset) return { preset: null, clips: [] };
  const chosen = all ? null : findClip(project, project.selectedClipId);
  if (!all && !chosen) return { preset, clips: [] };
  const clips = [];
  for (const track of project.tracks) {
    if (track.type === "audio") continue;
    for (const clip of track.clips) {
      if (chosen && chosen.clip.id !== clip.id) continue;
      const picture = track.type !== "title" && preset.picture;
      const title = track.type === "title" && preset.title;
      if (picture || title) clips.push({ track, clip });
    }
  }
  return { preset, clips };
}

function applyRemix(all) {
  const { preset, clips } = remixTargets(all);
  if (!preset) {
    status.textContent = "Choose a Remix preset";
    return;
  }
  if (!clips.length) {
    status.textContent = all ? `${preset.name} has nothing to change` : "Select a clip to remix";
    return;
  }
  pushUndo();
  for (const { track, clip } of clips) Object.assign(clip, track.type === "title" ? preset.title : preset.picture);
  inspector.dataset.signature = "";
  render();
  status.textContent = `${preset.name} on ${clips.length} clip${clips.length === 1 ? "" : "s"}`;
}

remixSelect.addEventListener("change", () => {
  if (!remixSelect.value) return;
  applyRemix(false);
});
document.querySelector("#remix-all").addEventListener("click", () => applyRemix(true));

document.querySelector("#export-btn").addEventListener("click", async () => {
  const button = document.querySelector("#export-btn");
  const format = formats.find((item) => item.id === exportFormat.value) || formats[0];
  button.disabled = true;
  exportSize.disabled = true;
  exportFormat.disabled = true;
  status.textContent = "Exporting…";
  try {
    const blob = await engine.export(project, mediaMap(), (progress, frame) => {
      const percent = Math.round(progress * 100);
      const size = frame ? `${frame.width}×${frame.height}` : exportSize.selectedOptions[0].textContent;
      status.textContent = `Exporting ${format.label} ${size} ${percent}%`;
      exportBar.style.width = `${percent}%`;
    }, engine.ctx, exportSize.value, format);
    exportBar.style.width = "0";
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    const formatName = (formats.find((item) => item.id === exportFormat.value) || formats[0]);
    const filename = `${project.name.replace(/[^\w.-]+/g, "-") || "reel"}.${formatName.extension}`;
    link.download = filename;
    link.click();
    status.textContent = `Exported ${filename}`;
  } catch (error) {
    status.textContent = error.message || "Export failed";
  } finally {
    exportBar.style.width = "0";
    button.disabled = false;
    exportSize.disabled = false;
    exportFormat.disabled = false;
    refreshPreview();
  }
});
playBtn.addEventListener("click", togglePlay);
fileInput.addEventListener("change", () => {
  if (fileInput.files?.length) void importFiles([...fileInput.files]);
  fileInput.value = "";
});
zoom.addEventListener("input", () => {
  project.pxPerSec = Number(zoom.value);
  renderTimeline();
  playhead.style.left = `${84 + project.playhead * project.pxPerSec}px`;
});

timeline.addEventListener("pointerdown", (event) => {
  followPlayhead = false;
  if (event.target.closest(".track-label")) return;
  const marker = event.target.closest(".marker");
  if (marker) {
    seek(Number(marker.dataset.time));
    return;
  }
  const clipEl = event.target.closest(".clip");
  if (!clipEl) {
    const scrub = (moveEvent) => seek(timeAt(moveEvent));
    scrub(event);
    const stop = () => {
      window.removeEventListener("pointermove", scrub);
      window.removeEventListener("pointerup", stop);
    };
    window.addEventListener("pointermove", scrub);
    window.addEventListener("pointerup", stop);
    return;
  }
  const found = findClip(project, clipEl.dataset.id);
  if (!found) return;
  project.selectedClipId = found.clip.id;
  renderTimeline();
  renderInspector();
  const clip = findClip(project, clipEl.dataset.id).clip;
  const element = tracksEl.querySelector(`[data-id="${clip.id}"]`);
  const origin = { start: clip.start, duration: clip.duration, inPoint: clip.inPoint, time: timeAt(event) };
  const bounds = element.getBoundingClientRect();
  const mode = event.clientX - bounds.left < 8 ? "left" : bounds.right - event.clientX < 8 ? "right" : "move";
  try { element.setPointerCapture(event.pointerId); } catch { /* the pointer can already be released */ }
  let changed = false;
  let lastPoint = { x: event.clientX, y: event.clientY };
  const move = (moveEvent) => {
    lastPoint = { x: moveEvent.clientX, y: moveEvent.clientY };
    if (!changed && Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) < 3) return;
    if (!changed) {
      pushUndo();
      changed = true;
    }
    const delta = timeAt(moveEvent) - origin.time;
    clip.start = origin.start;
    clip.duration = origin.duration;
    clip.inPoint = origin.inPoint;
    if (mode === "left") trimLeft(clip, Math.max(neighborEnd(found.track, clip, origin.start), origin.start + delta), limitFor(clip));
    else if (mode === "right") {
      const room = neighborStart(found.track, clip, origin.start) - origin.start;
      trimRight(clip, Math.min(origin.duration + delta, room), limitFor(clip));
    } else {
      clip.start = snapTime(Math.max(0, origin.start + delta), clip.id);
    }
    element.style.left = `${clip.start * project.pxPerSec}px`;
    element.style.width = `${Math.max(12, clip.duration * project.pxPerSec)}px`;
    paintClipFace(element, clip, project.media.find((item) => item.id === clip.mediaId), found.track);
    refreshPreview();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    if (mode === "move" && changed) {
      const lane = document.elementFromPoint(lastPoint.x, lastPoint.y)?.closest(".lane");
      if (lane && lane.dataset.track !== found.track.id) moveClipToTrack(project, clip, lane.dataset.track);
    }
    if (changed) render();
    else {
      renderTimeline();
      renderInspector();
    }
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
});

window.addEventListener("keydown", (event) => {
  const typing = ["INPUT", "TEXTAREA"].includes(event.target.tagName);
  if (event.key === " " && !typing) {
    event.preventDefault();
    togglePlay();
  } else if (event.key === "ArrowLeft" && !typing) {
    event.preventDefault();
    seek(project.playhead - (event.shiftKey ? 1 : 0.1));
  } else if (event.key === "ArrowRight" && !typing) {
    event.preventDefault();
    seek(project.playhead + (event.shiftKey ? 1 : 0.1));
  } else if (event.key === "Home" && !typing) {
    seek(0);
  } else if (event.key === "End" && !typing) {
    seek(projectEnd(project));
  } else if ((event.key === "Delete" || event.key === "Backspace") && !typing) {
    pushUndo();
    if (!deleteSelected(project)) undoStack.pop();
    render();
  } else if (event.key.toLowerCase() === "s" && !event.ctrlKey && !typing) {
    pushUndo();
    if (!splitSelected(project)) undoStack.pop();
    else render();
  } else if (event.key.toLowerCase() === "d" && (event.ctrlKey || event.metaKey) && !typing) {
    event.preventDefault();
    pushUndo();
    if (!duplicateSelected(project)) undoStack.pop();
    else render();
  } else if (event.key.toLowerCase() === "z" && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    if (event.shiftKey) redo();
    else undo();
  }
});

for (const target of [document.querySelector(".bin"), document.querySelector(".preview-pane"), timeline]) {
  target.addEventListener("dragover", (event) => event.preventDefault());
  target.addEventListener("drop", (event) => {
    event.preventDefault();
    if (event.dataTransfer?.files?.length) void importFiles([...event.dataTransfer.files]);
  });
}

document.querySelector("#start-btn").addEventListener("click", () => seek(0));
document.querySelector("#end-btn").addEventListener("click", () => seek(projectEnd(project)));
projectName.addEventListener("dblclick", () => {
  const input = document.createElement("input");
  input.className = "name-edit";
  input.value = project.name;
  projectName.replaceWith(input);
  input.focus();
  input.select();
  const commit = () => {
    project.name = input.value.trim() || "Untitled";
    projectName.textContent = project.name;
    input.replaceWith(projectName);
  };
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
    if (event.key === "Escape") {
      input.value = project.name;
      input.blur();
    }
  });
  input.addEventListener("blur", commit);
});

const preview = document.querySelector("#preview");

function previewPoint(event) {
  const rect = preview.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * preview.width,
    y: ((event.clientY - rect.top) / rect.height) * preview.height,
  };
}

function placedClips() {
  const frame = stageRect(preview.width, preview.height, project.aspect || "16:9");
  const list = [];
  for (const track of project.tracks) {
    if (track.type === "audio" || track.type === "adjust" || track.muted) continue;
    for (const clip of track.clips) {
      if (project.playhead < clip.start || project.playhead >= clip.start + clip.duration) continue;
      const box = track.type === "title" ? titleBox(frame, clip, project.playhead) : visualBox(frame, clip, project.playhead);
      list.push({ track, clip, box, frame });
    }
  }
  return list;
}

function clipUnder(point, clips) {
  return [...clips].reverse().find((item) => point.x >= item.box.x && point.x <= item.box.x + item.box.w && point.y >= item.box.y && point.y <= item.box.y + item.box.h);
}

function handleUnder(box, point) {
  const size = Math.max(10, Math.min(box.w, box.h) / 18);
  return [[box.x, box.y], [box.x + box.w, box.y], [box.x, box.y + box.h], [box.x + box.w, box.y + box.h]]
    .some(([hx, hy]) => Math.abs(point.x - hx) <= size && Math.abs(point.y - hy) <= size);
}

function beginFit(event, hit, mode, point) {
  if (hit.clip.frame) fitClip(hit.clip, hit.clip.frame.x, hit.clip.frame.y, hit.clip.frame.scale);
  const grab = {
    dx: (point.x - hit.box.cx) / hit.frame.w,
    dy: (point.y - hit.box.cy) / hit.frame.h,
    dist: Math.max(8, Math.hypot(point.x - hit.box.cx, point.y - hit.box.cy)),
    scale: hit.clip.scale ?? 1,
    cx: hit.box.cx,
    cy: hit.box.cy,
  };
  let changed = false;
  const move = (moveEvent) => {
    const next = previewPoint(moveEvent);
    if (!changed && Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) < 3) return;
    if (!changed) {
      pushUndo();
      changed = true;
    }
    if (mode === "scale") {
      const dist = Math.max(8, Math.hypot(next.x - grab.cx, next.y - grab.cy));
      fitClip(hit.clip, hit.clip.x ?? 0.5, hit.clip.y ?? 0.5, Math.min(3, Math.max(0.08, grab.scale * dist / grab.dist)));
    } else {
      const live = stageRect(preview.width, preview.height, project.aspect || "16:9");
      fitClip(
        hit.clip,
        Math.min(1.5, Math.max(-0.5, (next.x - live.x) / live.w - grab.dx)),
        Math.min(1.5, Math.max(-0.5, (next.y - live.y) / live.h - grab.dy)),
        hit.clip.scale ?? 1,
      );
    }
    refreshPreview();
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    render();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

preview.addEventListener("pointerdown", (event) => {
  const point = previewPoint(event);
  const clips = placedClips();
  const selected = clips.find((item) => item.clip.id === project.selectedClipId);
  if (selected && handleUnder(selected.box, point)) {
    event.preventDefault();
    beginFit(event, selected, "scale", point);
    return;
  }
  const hit = clipUnder(point, clips);
  if (!hit) return;
  project.selectedClipId = hit.clip.id;
  event.preventDefault();
  beginFit(event, hit, "move", point);
});

preview.addEventListener("pointermove", (event) => {
  if (event.buttons) return;
  const point = previewPoint(event);
  const clips = placedClips();
  const selected = clips.find((item) => item.clip.id === project.selectedClipId);
  if (selected && handleUnder(selected.box, point)) {
    preview.style.cursor = "nwse-resize";
    return;
  }
  preview.style.cursor = clipUnder(point, clips) ? "move" : "default";
});

const canvas = preview;
const observer = new ResizeObserver(() => {
  if (engine.exporting) return;
  engine.resize(canvas.clientWidth, canvas.clientHeight);
  refreshPreview();
});
observer.observe(canvas);
render();
