import { gifFrame, gifHeader, gifTrailer } from "./gif.js";
import { clipAt, envelope, mediaTime, opacityAt, projectEnd, speedAt } from "./model.js";

export class PreviewEngine {
  constructor(canvas) {
    this.preview = canvas;
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.exporting = false;
    this.nodes = new Map();
    this.context = null;
    this.playing = false;
    this.frame = 0;
    this.onSeeked = null;
    this.stage = document.createElement("div");
    this.stage.className = "media-stage";
    document.body.append(this.stage);
  }

  ensureContext() {
    if (!this.context) this.context = new AudioContext();
    if (this.context.state === "suspended") void this.context.resume();
    return this.context;
  }

  prepare(project, mediaById) {
    const live = new Set();
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        const media = mediaById.get(clip.mediaId);
        if (!media || media.kind === "color") continue;
        live.add(clip.id);
        if (!this.nodes.has(clip.id)) this.createNode(clip, media, track);
      }
    }
    for (const [id, node] of this.nodes) {
      if (live.has(id)) continue;
      if (node.kind !== "image") {
        node.element.pause();
        node.element.removeAttribute("src");
        node.element.load();
        node.element.remove();
      }
      node.gain?.disconnect();
      this.nodes.delete(id);
    }
  }

  createNode(clip, media, track) {
    if (media.kind === "image") {
      const image = new Image();
      image.src = media.url;
      image.addEventListener("load", () => {
        media.width = image.naturalWidth;
        media.height = image.naturalHeight;
        if (!this.playing && this.onSeeked) this.onSeeked();
      });
      this.nodes.set(clip.id, { element: image, kind: "image", mediaId: media.id, gain: null });
      return;
    }
    const kind = media.kind === "video" && track.type !== "audio" ? "video" : "audio";
    const element = document.createElement(kind);
    element.src = media.url;
    element.preload = "auto";
    element.playsInline = true;
    if (kind === "video") {
      element.width = 160;
      element.height = 90;
    }
    this.stage.append(element);
    const node = { element, kind, mediaId: media.id, gain: null };
    const ready = () => {
      if (kind === "video" && element.videoWidth) {
        media.width = element.videoWidth;
        media.height = element.videoHeight;
      }
      if (!this.playing && this.onSeeked) this.onSeeked();
    };
    element.addEventListener("loadeddata", ready);
    element.addEventListener("seeked", ready);
    this.nodes.set(clip.id, node);
  }

  connect(node) {
    if (!node || node.kind === "image" || node.gain) return node?.gain;
    const context = this.ensureContext();
    const source = context.createMediaElementSource(node.element);
    const gain = context.createGain();
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    gain.gain.value = 0;
    source.connect(analyser);
    node.source = source;
    node.gain = gain;
    node.analyser = analyser;
    node.vocal = false;
    node.invert = null;
    node.splitter = null;
    this.routeAudio(node, false);
    return gain;
  }

  routeAudio(node, vocal) {
    const context = this.ensureContext();
    try { node.source.disconnect(); } catch { /* already open */ }
    try { node.gain.disconnect(); } catch { /* already open */ }
    try { node.invert?.disconnect(); } catch { /* already open */ }
    try { node.splitter?.disconnect(); } catch { /* already open */ }
    node.source.connect(node.analyser);
    if (vocal) {
      const splitter = context.createChannelSplitter(2);
      const invert = context.createGain();
      invert.gain.value = -1;
      node.source.connect(splitter);
      splitter.connect(node.gain, 0);
      splitter.connect(invert, 1);
      invert.connect(node.gain);
      node.splitter = splitter;
      node.invert = invert;
    } else {
      node.source.connect(node.gain);
      node.splitter = null;
      node.invert = null;
    }
    node.gain.connect(context.destination);
    this.tapExport(node.gain);
    node.vocal = vocal;
  }

  tapExport(gain) {
    if (!gain || !this.exportTap) return;
    try { gain.connect(this.exportTap); } catch { /* the recording tap is already connected */ }
  }

  resize(width, height) {
    if (this.exporting) return;
    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(2, Math.round(width * dpr));
    const nextHeight = Math.max(2, Math.round(height * dpr));
    if (this.preview.width === nextWidth && this.preview.height === nextHeight) return;
    this.preview.width = nextWidth;
    this.preview.height = nextHeight;
    if (this.canvas === this.preview) this.ctx = this.preview.getContext("2d");
  }

  render(project, mediaById, time) {
    this.prepare(project, mediaById);
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    const width = this.canvas.width;
    const height = this.canvas.height;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#070707";
    ctx.fillRect(0, 0, width, height);
    const frame = stageRect(width, height, project.aspect || "16:9");
    ctx.save();
    ctx.beginPath();
    ctx.rect(frame.x, frame.y, frame.w, frame.h);
    ctx.clip();
    ctx.fillStyle = "#111";
    ctx.fillRect(frame.x, frame.y, frame.w, frame.h);
    let drew = false;
    for (const track of project.tracks) {
      if (track.type === "audio" || track.type === "adjust" || track.muted) continue;
      if (track.type === "title") continue;
      for (const clip of track.clips) {
        if (time < clip.start || time >= clip.start + clip.duration) continue;
        const media = mediaById.get(clip.mediaId);
        const node = this.nodes.get(clip.id);
        drawClip(ctx, frame, track, clip, media, node?.element, time);
        drew = true;
      }
    }
    drew = applyGrade(ctx, frame, project, time) || drew;
    for (const track of project.tracks) {
      if (track.type !== "title" || track.muted) continue;
      for (const clip of track.clips) {
        if (time < clip.start || time >= clip.start + clip.duration) continue;
        const media = mediaById.get(clip.mediaId);
        drawClip(ctx, frame, track, clip, media, null, time);
        drew = true;
      }
    }
    if (!drew && !project.tracks.some((track) => track.type !== "audio" && track.clips.length)) {
      ctx.fillStyle = "#8d8478";
      ctx.font = `600 ${Math.max(16, frame.w / 42)}px "Segoe UI", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("Import video or pictures to start", frame.x + frame.w / 2, frame.y + frame.h / 2);
    }
    if (project.guides) {
      ctx.save();
      ctx.strokeStyle = "rgba(224, 122, 69, 0.9)";
      ctx.lineWidth = Math.max(1, frame.w / 480);
      const insetX = frame.w * 0.08;
      const insetY = frame.h * 0.08;
      ctx.strokeRect(frame.x + insetX, frame.y + insetY, frame.w - insetX * 2, frame.h - insetY * 2);
      ctx.restore();
    }
    ctx.restore();
    if (!this.exporting) drawSelection(ctx, frame, project, time);
  }

  sync(project, mediaById, time, playing) {
    this.prepare(project, mediaById);
    const active = new Set();
    for (const track of project.tracks) {
      if (track.muted) continue;
      for (const clip of track.clips) {
        const node = this.nodes.get(clip.id);
        if (!node || node.kind === "image") continue;
        const element = node.element;
        const inside = time >= clip.start && time < clip.start + clip.duration;
        const gain = this.connect(node);
        if (node.vocal !== Boolean(clip.vocal)) this.routeAudio(node, Boolean(clip.vocal));
        let level = inside ? (clip.volume ?? 1) * envelope(clip, time) : 0;
        if (inside && clip.duck && pictureAt(project, time)) level *= 0.22;
        if (inside && clip.gate && node.analyser && quiet(node.analyser)) level = 0;
        if (this.exporting) level = 0;
        if (gain) gain.gain.setTargetAtTime(level, this.context.currentTime, 0.015);
        if (this.exporting && node.kind === "audio") continue;
        if (!inside) continue;
        active.add(clip.id);
        const local = mediaTime(clip, time);
        const speed = speedAt(clip, time);
        if (element.playbackRate !== speed) element.playbackRate = speed;
        if (playing) {
          const drift = Math.abs(element.currentTime - local);
          const limit = this.exporting ? 0.08 : 0.35;
          if (element.ended || element.paused) {
            if (element.ended || drift > 0.08) {
              try { element.currentTime = local; } catch { /* the file is not seekable yet */ }
            }
            void element.play().catch(() => {});
          } else if (!element.seeking && drift > limit) {
            try { element.currentTime = local; } catch { /* the file is not seekable yet */ }
          }
        } else if (!element.seeking && Math.abs(element.currentTime - local) > 0.08) {
          element.currentTime = local;
        }
      }
    }
    if (this.exporting) return;
    for (const [id, node] of this.nodes) {
      const shouldPlay = playing && active.has(id);
      if (node.kind === "image" || shouldPlay || node.element.paused) continue;
      node.element.pause();
    }
  }

  gainsFor(node) {
    if (!this.context) return null;
    return node.gain;
  }

  masterTime(project, fallback) {
    for (const track of project.tracks) {
      if (track.muted || track.type === "title") continue;
      const clip = clipAt(track, fallback);
      const node = clip && this.nodes.get(clip.id);
      if (!node || node.kind !== "video") continue;
      const element = node.element;
      if (element.paused || element.seeking || element.readyState < 2) continue;
      const time = clip.start + (element.currentTime - clip.inPoint) / (clip.speed || 1);
      if (!Number.isFinite(time)) continue;
      return time;
    }
    return null;
  }

  play(project, mediaById, clock) {
    this.playing = true;
    this.ensureContext();
    this.prepare(project, mediaById);
    for (const node of this.nodes.values()) {
      if (node.kind !== "image") this.connect(node);
    }
    const at = clock.get();
    this.sync(project, mediaById, at, true);
    this.render(project, mediaById, at);
    let last = performance.now();
    const tick = (now) => {
      if (!this.playing) return;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      let time = clock.get() + dt;
      const mastered = this.masterTime(project, time);
      if (mastered != null) time = mastered;
      const end = projectEnd(project);
      if (time >= end - 0.02) {
        if (project.loop) {
          clock.set(0);
          for (const node of this.nodes.values()) {
            if (node.kind === "image" || node.element.paused) continue;
            node.element.pause();
          }
          this.sync(project, mediaById, 0, true);
          this.render(project, mediaById, 0);
          last = now;
          this.frame = requestAnimationFrame(tick);
          return;
        }
        clock.set(end);
        this.sync(project, mediaById, end, false);
        this.render(project, mediaById, end);
        this.playing = false;
        clock.stopped();
        return;
      }
      clock.set(time);
      this.sync(project, mediaById, time, true);
      this.render(project, mediaById, time);
      this.frame = requestAnimationFrame(tick);
    };
    this.frame = requestAnimationFrame(tick);
  }

  async awaitVisuals() {
    const pending = [];
    for (const node of this.nodes.values()) {
      if (node.kind !== "image") continue;
      const image = node.element;
      if (image.complete && image.naturalWidth) continue;
      pending.push(new Promise((resolve) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", resolve, { once: true });
      }));
    }
    if (pending.length) await Promise.all(pending);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.frame);
    for (const node of this.nodes.values()) {
      if (node.kind === "image" || node.element.paused) continue;
      node.element.pause();
    }
  }

  async export(project, mediaById, onProgress, mirror, choice = "3840", format) {
    const end = projectEnd(project);
    const frameSize = exportFrameSize(mediaById, choice, project.aspect || "16:9");
    const { width, height } = format?.kind === "gif" ? gifSize(frameSize) : frameSize;
    if (format?.kind === "gif") return this.exportGif(project, mediaById, onProgress, mirror, width, height, end);
    this.exporting = true;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const previous = { canvas: this.canvas, ctx: this.ctx };
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false });
    const context = this.ensureContext();
    const recordContext = new AudioContext();
    const recordDestination = recordContext.createMediaStreamDestination();
    const sources = [];
    let silence = null;
    canvas.style.cssText = "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none";
    document.body.appendChild(canvas);
    try {
      this.prepare(project, mediaById);
      this.pause();
      for (const node of this.nodes.values()) {
        if (node.gain) node.gain.gain.setValueAtTime(0, context.currentTime);
      }
      if (context.state !== "running") await context.resume();
      if (recordContext.state !== "running") await recordContext.resume();
      await this.awaitVisuals();
      const buffers = await loadExportBuffers(recordContext, project, mediaById);
      const lead = 0.08;
      const origin = recordContext.currentTime + lead;
      sources.push(...startExportAudio(recordContext, recordDestination, project, mediaById, buffers, origin));
      const fps = 30;
      const audioOnly = format?.kind === "audio";
      if (!sources.length) {
        silence = recordContext.createOscillator();
        const mute = recordContext.createGain();
        mute.gain.value = 0.0001;
        silence.connect(mute);
        mute.connect(recordDestination);
        silence.start();
      }
      const audioTrack = recordDestination.stream.getAudioTracks()[0] || null;
      const stream = audioOnly ? new MediaStream(audioTrack ? [audioTrack] : []) : canvas.captureStream(0);
      const videoTrack = audioOnly ? null : stream.getVideoTracks()[0];
      if (!audioOnly && audioTrack) stream.addTrack(audioTrack);
      const options = { audioBitsPerSecond: audioOnly ? 320000 : 510000 };
      if (!audioOnly) options.videoBitsPerSecond = Math.round(width * height * fps * 0.4);
      if (format?.mime) options.mimeType = format.mime;
      const recorder = openRecorder(stream, options);
      const chunks = [];
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunks.push(event.data);
      };
      const stopped = new Promise((resolve, reject) => {
        recorder.onstop = resolve;
        recorder.onerror = (event) => reject(event.error || new Error("Export recorder failed"));
      });
      const paint = (time, playing) => {
        this.sync(project, mediaById, time, playing);
        this.render(project, mediaById, time);
        if (mirror) mirror.drawImage(canvas, 0, 0, mirror.canvas.width, mirror.canvas.height);
        videoTrack?.requestFrame();
      };
      const untilPicture = Math.max(0, (origin - recordContext.currentTime) * 1000);
      await wait(untilPicture);
      paint(0, true);
      recorder.start(100);
      videoTrack?.requestFrame();
      const started = performance.now();
      for (;;) {
        const time = (performance.now() - started) / 1000;
        if (time >= end) break;
        paint(time, true);
        onProgress(Math.min(1, time / end), { width, height });
        await wait(1000 / fps);
      }
      paint(end, false);
      await wait(120);
      if (recorder.state === "recording") recorder.stop();
      await stopped;
      await wait(50);
      const blob = new Blob(chunks, { type: recorder.mimeType || format?.mime || "video/webm" });
      if (!blob.size) throw new Error("Export produced an empty file");
      return blob;
    } finally {
      this.exporting = false;
      this.exportTap = null;
      silence?.stop();
      for (const source of sources) {
        try { source.stop(); } catch { /* already finished */ }
      }
      void recordContext.close();
      this.pause();
      canvas.remove();
      this.canvas = previous.canvas;
      this.ctx = previous.ctx;
    }
  }

  async exportGif(project, mediaById, onProgress, mirror, width, height, end) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const previous = { canvas: this.canvas, ctx: this.ctx };
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
    const fps = 10;
    const parts = gifHeader(width, height);
    this.exporting = true;
    try {
      this.pause();
      this.prepare(project, mediaById);
      await this.awaitVisuals();
      const frames = Math.max(1, Math.round(end * fps));
      for (let index = 0; index < frames; index += 1) {
        const time = Math.min(end, index / fps);
        this.sync(project, mediaById, time, false);
        this.render(project, mediaById, time);
        if (mirror) mirror.drawImage(canvas, 0, 0, mirror.canvas.width, mirror.canvas.height);
        parts.push(...gifFrame(this.ctx.getImageData(0, 0, width, height), width, height, 100 / fps));
        onProgress((index + 1) / frames, { width, height });
        await wait(0);
      }
      parts.push(gifTrailer());
      return new Blob(parts, { type: "image/gif" });
    } finally {
      this.exporting = false;
      this.canvas = previous.canvas;
      this.ctx = previous.ctx;
    }
  }
}

function sourceWidth(mediaById) {
  let width = 0;
  for (const media of mediaById.values()) {
    if (!media?.width) continue;
    width = Math.max(width, media.width, (media.height || 0) * (16 / 9));
  }
  return width;
}

function gifSize(size) {
  if (size.width <= 1280) return size;
  const height = Math.ceil((size.height * 1280) / size.width / 2) * 2;
  return { width: 1280, height };
}

async function loadExportBuffers(recordContext, project, mediaById) {
  const buffers = new Map();
  for (const track of project.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      const media = mediaById.get(clip.mediaId);
      if (!media?.url || buffers.has(media.id)) continue;
      if (media.kind === "image" || media.kind === "color" || media.kind === "title") continue;
      try {
        const data = await (await fetch(media.url)).arrayBuffer();
        buffers.set(media.id, await recordContext.decodeAudioData(data.slice(0)));
      } catch {
        buffers.set(media.id, null);
      }
    }
  }
  return buffers;
}

function startExportAudio(recordContext, destination, project, mediaById, buffers, origin) {
  const sources = [];
  for (const track of project.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      const media = mediaById.get(clip.mediaId);
      const buffer = media && buffers.get(media.id);
      if (!buffer) continue;
      const rate = exportRate(clip);
      const offset = Math.min(Math.max(0, clip.inPoint || 0), Math.max(0, buffer.duration - 0.02));
      const span = Math.min(clip.duration, Math.max(0, buffer.duration - offset) / rate);
      if (span < 0.02) continue;
      const source = recordContext.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      const gain = recordContext.createGain();
      if (clip.vocal && buffer.numberOfChannels > 1) {
        const splitter = recordContext.createChannelSplitter(2);
        const invert = recordContext.createGain();
        invert.gain.value = -1;
        source.connect(splitter);
        splitter.connect(gain, 0);
        splitter.connect(invert, 1);
        invert.connect(gain);
      } else {
        source.connect(gain);
      }
      gain.connect(destination);
      const when = origin + clip.start;
      gain.gain.setValueAtTime(exportLevel(project, clip, clip.start), when);
      const step = 0.05;
      for (let local = step; local < span; local += step) {
        gain.gain.linearRampToValueAtTime(exportLevel(project, clip, clip.start + local), when + local);
      }
      gain.gain.linearRampToValueAtTime(exportLevel(project, clip, clip.start + span), when + span);
      source.start(when, offset, span * rate);
      sources.push(source);
    }
  }
  return sources;
}

function exportRate(clip) {
  const start = clip.speed || 1;
  const end = clip.speedEnd == null ? start : clip.speedEnd;
  return Math.max(0.25, (start + end) / 2);
}

function exportLevel(project, clip, time) {
  let level = (clip.volume ?? 1) * envelope(clip, time);
  if (clip.duck && pictureAt(project, time)) level *= 0.22;
  return Math.max(0, Math.min(1, level));
}

function exportFrameSize(mediaById, choice, aspect) {
  const source = sourceWidth(mediaById);
  let longEdge = 3840;
  if (choice === "source") longEdge = source || 1920;
  else if (choice === "highest") longEdge = Math.max(3840, source);
  else longEdge = Number(choice) || 3840;
  const [aw, ah] = (aspect || "16:9").split(":").map(Number);
  const landscape = aw >= ah;
  let width = landscape ? longEdge : longEdge * (aw / ah);
  let height = landscape ? longEdge * (ah / aw) : longEdge;
  width = Math.max(2, Math.ceil(width / 2) * 2);
  height = Math.max(2, Math.ceil(height / 2) * 2);
  return { width, height };
}

function openRecorder(stream, options) {
  try {
    return new MediaRecorder(stream, options);
  } catch {
    const mimeType = options.mimeType;
    return new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  }
}

export function stageRect(width, height, aspect = "16:9") {
  const [aw, ah] = aspect.split(":").map(Number);
  const ratio = aw / ah;
  let w = width;
  let h = width / ratio;
  if (h > height) {
    h = height;
    w = height * ratio;
  }
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

function pictureAt(project, time) {
  return project.tracks.some((track) => track.type !== "audio" && track.type !== "title" && track.type !== "adjust" && !track.muted && track.clips.some((clip) => time >= clip.start && time < clip.start + clip.duration));
}

function quiet(analyser) {
  const data = new Float32Array(analyser.fftSize);
  analyser.getFloatTimeDomainData(data);
  let sum = 0;
  for (const value of data) sum += value * value;
  return Math.sqrt(sum / data.length) < 0.02;
}

function applyGrade(ctx, frame, project, time) {
  const track = project.tracks.find((item) => item.type === "adjust" && !item.muted);
  const clip = track && clipAt(track, time);
  if (!clip) return false;
  const sample = gradeCanvas(frame.w, frame.h);
  const sampleCtx = sample.getContext("2d", { willReadFrequently: true });
  sampleCtx.clearRect(0, 0, sample.width, sample.height);
  sampleCtx.drawImage(ctx.canvas, frame.x, frame.y, frame.w, frame.h, 0, 0, sample.width, sample.height);
  ctx.save();
  ctx.filter = visualFilter(clip, frame.w);
  ctx.drawImage(sample, frame.x, frame.y, frame.w, frame.h);
  ctx.restore();
  return true;
}

let gradeSurface = null;
function gradeCanvas(width, height) {
  const w = Math.max(2, Math.round(width));
  const h = Math.max(2, Math.round(height));
  if (!gradeSurface || gradeSurface.width !== w || gradeSurface.height !== h) {
    gradeSurface = document.createElement("canvas");
    gradeSurface.width = w;
    gradeSurface.height = h;
  }
  return gradeSurface;
}

function drawClip(ctx, frame, track, clip, media, visual, time) {
  const alpha = opacityAt(clip, time);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = clip.blend || "source-over";
  if (track.type === "title" || media?.kind === "title") {
    drawTitle(ctx, frame, clip, time);
    ctx.restore();
    return;
  }
  const box = visualBox(frame, clip, time);
  ctx.filter = visualFilter(clip, ctx.canvas.width);
  if (!media || media.kind === "color") {
    ctx.fillStyle = media?.color || clip.color || "#e36a4a";
    paintVisual(ctx, box, clip, (x, y, w, h) => ctx.fillRect(x, y, w, h));
  } else if (visual && (media.kind === "image" || visual.readyState >= 2)) {
    const paint = clip.chromaEnabled
      ? (x, y, w, h) => drawKeyed(ctx, visual, x, y, w, h, clip.chroma, clip.chromaAmount)
      : (x, y, w, h) => drawCover(ctx, visual, x, y, w, h);
    paintVisual(ctx, box, clip, paint);
  }
  ctx.filter = "none";
  if (clip.effect === "grain" || clip.vignette) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(box.x, box.y, box.w, box.h);
    ctx.clip();
    if (clip.effect === "grain") drawGrain(ctx, box, time);
    if (clip.vignette) {
      const gradient = ctx.createRadialGradient(box.cx, box.cy, box.w * 0.2, box.cx, box.cy, box.w * 0.62);
      gradient.addColorStop(0, "rgba(0,0,0,0)");
      gradient.addColorStop(1, "rgba(0,0,0,0.62)");
      ctx.fillStyle = gradient;
      ctx.fillRect(box.x, box.y, box.w, box.h);
    }
    ctx.restore();
  }
  ctx.restore();
}

function visualFilter(clip, canvasWidth) {
  const looks = {
    warm: "sepia(0.45)",
    cool: "hue-rotate(24deg) saturate(1.1)",
    mono: "grayscale(1)",
    noir: "grayscale(1) contrast(1.2)",
    punch: "contrast(1.2) saturate(1.25)",
    fade: "contrast(0.9) saturate(0.8)",
  };
  const blur = (clip.blur || 0) * (canvasWidth / 1280);
  const temperature = clip.temperature || 0;
  const warmth = temperature > 0 ? `sepia(${temperature * 0.65})` : `hue-rotate(${(-temperature) * 32}deg)`;
  return `brightness(${clip.brightness ?? 1}) contrast(${clip.contrast ?? 1}) saturate(${clip.saturate ?? 1}) blur(${blur}px) ${warmth} ${looks[clip.look] || ""}`;
}

export function visualBox(frame, clip, time) {
  const ken = clip.kenBurns ? 1 + ((time - clip.start) / Math.max(0.1, clip.duration)) * 0.22 : 1;
  const spot = clip.frame || { x: clip.x ?? 0.5, y: clip.y ?? 0.5, scale: clip.scale ?? 1 };
  const scale = (spot.scale ?? 1) * ken;
  const w = frame.w * scale;
  const h = frame.h * scale;
  const cx = frame.x + (spot.x ?? 0.5) * frame.w;
  const cy = frame.y + (spot.y ?? 0.5) * frame.h;
  return { x: cx - w / 2, y: cy - h / 2, w, h, cx, cy };
}

export function titleBox(frame, clip, time) {
  const size = Math.round((clip.fontSize || 72) * (clip.scale ?? 1) * (frame.w / 1280));
  const text = clip.text || "Title";
  const width = Math.max(size * 2, text.length * size * 0.52);
  const height = size * 1.6;
  let cy = frame.y + (clip.y ?? 0.5) * frame.h;
  if (clip.motion === "rise") {
    const span = Math.max(0.2, clip.fadeIn || 0.4);
    const progress = Math.min(1, Math.max(0, (time - clip.start) / span));
    cy += (1 - progress) * frame.h * 0.08;
  }
  const cx = frame.x + (clip.x ?? 0.5) * frame.w;
  return { x: cx - width / 2, y: cy - height / 2, w: width, h: height, cx, cy };
}

function paintVisual(ctx, box, clip, paint) {
  ctx.save();
  ctx.translate(box.cx, box.cy);
  ctx.rotate(((clip.rotate || 0) * Math.PI) / 180);
  if (clip.flip) ctx.scale(-1, 1);
  if (clip.shape === "circle") {
    ctx.beginPath();
    ctx.ellipse(0, 0, box.w / 2, box.h / 2, 0, 0, Math.PI * 2);
    ctx.clip();
  }
  paint(-box.w / 2, -box.h / 2, box.w, box.h);
  ctx.restore();
}

function drawSelection(ctx, frame, project, time) {
  let chosen = null;
  for (const track of project.tracks) {
    if (track.type === "audio" || track.type === "adjust") continue;
    const clip = track.clips.find((item) => item.id === project.selectedClipId);
    if (!clip || time < clip.start || time >= clip.start + clip.duration) continue;
    chosen = track.type === "title" ? titleBox(frame, clip, time) : visualBox(frame, clip, time);
  }
  if (!chosen) return;
  const handle = Math.max(10, Math.min(chosen.w, chosen.h) / 18);
  ctx.save();
  ctx.strokeStyle = "#e07a45";
  ctx.lineWidth = Math.max(2, frame.w / 480);
  ctx.strokeRect(chosen.x, chosen.y, chosen.w, chosen.h);
  ctx.fillStyle = "#f4efe6";
  for (const [hx, hy] of [[chosen.x, chosen.y], [chosen.x + chosen.w, chosen.y], [chosen.x, chosen.y + chosen.h], [chosen.x + chosen.w, chosen.y + chosen.h]]) {
    ctx.fillRect(hx - handle / 2, hy - handle / 2, handle, handle);
  }
  ctx.restore();
}

function drawCover(ctx, source, x, y, w, h) {
  const sw = source.videoWidth || source.naturalWidth || source.width;
  const sh = source.videoHeight || source.naturalHeight || source.height;
  if (!sw || !sh) return;
  const scale = Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(source, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

let keySurface = null;
function drawKeyed(ctx, source, x, y, w, h, color, amount) {
  const width = Math.max(2, Math.round(Math.abs(w)));
  const height = Math.max(2, Math.round(Math.abs(h)));
  if (!keySurface || keySurface.width !== width || keySurface.height !== height) {
    keySurface = document.createElement("canvas");
    keySurface.width = width;
    keySurface.height = height;
  }
  const keyCtx = keySurface.getContext("2d", { willReadFrequently: true });
  keyCtx.clearRect(0, 0, width, height);
  drawCover(keyCtx, source, 0, 0, width, height);
  const image = keyCtx.getImageData(0, 0, width, height);
  const key = hexColor(color);
  const tolerance = 40 + (amount ?? 0.45) * 180;
  const data = image.data;
  for (let index = 0; index < data.length; index += 4) {
    const distance = Math.abs(data[index] - key[0]) + Math.abs(data[index + 1] - key[1]) + Math.abs(data[index + 2] - key[2]);
    if (distance < tolerance) data[index + 3] = 0;
    else if (distance < tolerance * 1.35) data[index + 3] = Math.round(data[index + 3] * ((distance - tolerance) / (tolerance * 0.35)));
  }
  keyCtx.putImageData(image, 0, 0);
  ctx.drawImage(keySurface, x, y, w, h);
}

function hexColor(value) {
  const hex = String(value || "#00ff00").replace("#", "");
  return [parseInt(hex.slice(0, 2), 16) || 0, parseInt(hex.slice(2, 4), 16) || 0, parseInt(hex.slice(4, 6), 16) || 0];
}

function drawGrain(ctx, frame, time) {
  let seed = Math.floor(time * 24) + 17;
  const next = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const step = Math.max(6, frame.w / 48);
  ctx.save();
  for (let y = frame.y; y < frame.y + frame.h; y += step) {
    for (let x = frame.x; x < frame.x + frame.w; x += step) {
      const shade = Math.round(next() * 255);
      ctx.fillStyle = `rgba(${shade},${shade},${shade},0.22)`;
      ctx.fillRect(x, y, step, step);
    }
  }
  ctx.restore();
}

function drawTitle(ctx, frame, clip, time) {
  const size = Math.round((clip.fontSize || 72) * (clip.scale ?? 1) * (frame.w / 1280));
  const text = clip.text || "Title";
  let y = frame.y + clip.y * frame.h;
  if (clip.motion === "rise") {
    const span = Math.max(0.2, clip.fadeIn || 0.4);
    const progress = Math.min(1, Math.max(0, (time - clip.start) / span));
    y += (1 - progress) * frame.h * 0.08;
  }
  const x = frame.x + clip.x * frame.w;
  ctx.font = `600 ${size}px "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (clip.titleStyle === "lower") {
    const bar = Math.min(frame.w * 0.78, ctx.measureText(text).width + size);
    ctx.fillStyle = "rgba(12, 10, 8, 0.72)";
    ctx.fillRect(x - bar / 2, y - size * 0.75, bar, size * 1.5);
  }
  if (clip.titleStyle === "shadow") {
    ctx.shadowColor = "rgba(0,0,0,0.7)";
    ctx.shadowBlur = size / 4;
    ctx.shadowOffsetY = size / 10;
  }
  ctx.fillStyle = clip.color || "#f4efe6";
  if (clip.titleStyle === "outline") {
    ctx.lineWidth = Math.max(2, size / 16);
    ctx.strokeStyle = "#1a120c";
    ctx.strokeText(text, x, y);
  }
  ctx.fillText(text, x, y);
  ctx.shadowColor = "transparent";
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
