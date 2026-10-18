export function createProject() {
  return {
    name: "Untitled",
    pxPerSec: 72,
    aspect: "16:9",
    playhead: 0,
    tracks: [
      { id: "video", type: "video", name: "Video", muted: false, clips: [] },
      { id: "overlay", type: "overlay", name: "Overlay", muted: false, clips: [] },
      { id: "audio", type: "audio", name: "Audio", muted: false, clips: [] },
      { id: "title", type: "title", name: "Title", muted: false, clips: [] },
      { id: "grade", type: "adjust", name: "Grade", muted: false, clips: [] },
    ],
    media: [],
    selectedClipId: null,
    markers: [],
    loop: false,
    guides: false,
  };
}

export function projectEnd(project) {
  let end = 0;
  for (const track of project.tracks) {
    for (const clip of track.clips) end = Math.max(end, clip.start + clip.duration);
  }
  return Math.max(end, 0.1);
}

export function findClip(project, id) {
  for (const track of project.tracks) {
    const clip = track.clips.find((item) => item.id === id);
    if (clip) return { track, clip };
  }
  return null;
}

export function clipAt(track, time) {
  let found = null;
  for (const clip of track.clips) {
    if (time >= clip.start && time < clip.start + clip.duration - 1e-4) found = clip;
  }
  return found;
}

export function settle(track, clip) {
  const others = track.clips.filter((item) => item.id !== clip.id);
  let start = Math.max(0, clip.start);
  for (let pass = 0; pass < others.length + 1; pass += 1) {
    const hit = others.find((other) => {
      const gap = Math.min(clip.crossfade || 0, other.crossfade || 0, clip.duration * 0.45, other.duration * 0.45);
      return start < other.start + other.duration - gap - 0.02 && start + clip.duration > other.start + gap + 0.02;
    });
    if (!hit) break;
    const after = hit.start + hit.duration;
    const before = Math.max(0, hit.start - clip.duration);
    const preferAfter = before <= 0.001 || Math.abs(clip.start - after) <= Math.abs(clip.start - before);
    start = preferAfter ? after : before;
  }
  clip.start = start;
}

export function neighborStart(track, clip, originStart) {
  let start = Infinity;
  const originEnd = originStart + clip.duration;
  for (const other of track.clips) {
    if (other.id === clip.id) continue;
    if (other.start >= originEnd - 0.03) start = Math.min(start, other.start);
  }
  return start;
}

export function neighborEnd(track, clip, originStart) {
  let end = 0;
  for (const other of track.clips) {
    if (other.id === clip.id) continue;
    const edge = other.start + other.duration;
    if (edge <= originStart + 0.03) end = Math.max(end, edge);
  }
  return end;
}

export function sourceLimit(media) {
  if (!media || media.kind === "image" || media.kind === "color") return 3600;
  return media.duration || 3600;
}

export function makeClip(partial) {
  return {
    id: crypto.randomUUID(),
    mediaId: null,
    start: 0,
    inPoint: 0,
    duration: 3,
    speed: 1,
    volume: 1,
    opacity: 1,
    fadeIn: 0,
    fadeOut: 0.4,
    brightness: 1,
    contrast: 1,
    saturate: 1,
    scale: 1,
    x: 0.5,
    y: 0.5,
    text: "Title",
    fontSize: 72,
    color: "#f4efe6",
    blur: 0,
    rotate: 0,
    flip: false,
    look: "none",
    blend: "source-over",
    kenBurns: false,
    shape: "rect",
    titleStyle: "plain",
    motion: "none",
    vignette: false,
    crossfade: 0,
    temperature: 0,
    chromaEnabled: false,
    chroma: "#00ff00",
    chromaAmount: 0.45,
    effect: "none",
    duck: false,
    gate: false,
    vocal: false,
    speedEnd: null,
    frame: null,
    ...partial,
  };
}

export function addMedia(project, media) {
  project.media.push(media);
  return media;
}

export function trackForMedia(project, media) {
  if (media.kind === "audio" || media.kind === "tone") return project.tracks.find((track) => track.id === "audio");
  if (media.kind === "image") return project.tracks.find((track) => track.id === "video");
  return project.tracks.find((track) => track.id === "video");
}

export function placeClip(project, track, clip) {
  clip.start = Math.max(0, clip.start || 0);
  track.clips.push(clip);
  track.clips.sort((a, b) => a.start - b.start);
  project.selectedClipId = clip.id;
}

export function fitClip(clip, x, y, scale) {
  clip.x = x;
  clip.y = y;
  clip.scale = scale;
  clip.frame = null;
}

export function speedAt(clip, time) {
  const start = clip.speed || 1;
  const end = clip.speedEnd == null ? start : clip.speedEnd;
  const span = Math.max(0.1, clip.duration);
  const unit = Math.min(1, Math.max(0, (time - clip.start) / span));
  return start + (end - start) * unit;
}

export function mediaTime(clip, time) {
  const start = clip.speed || 1;
  const end = clip.speedEnd == null ? start : clip.speedEnd;
  const span = Math.max(0.1, clip.duration);
  const unit = Math.min(1, Math.max(0, (time - clip.start) / span));
  return clip.inPoint + span * (start * unit + (end - start) * unit * unit / 2);
}

function detachClip(project, clip) {
  for (const track of project.tracks) {
    const index = track.clips.findIndex((item) => item.id === clip.id);
    if (index >= 0) {
      track.clips.splice(index, 1);
      return track;
    }
  }
  return null;
}

function packClips(track, items, fadeImages, origin = 0) {
  let cursor = origin;
  const ordered = [...items].sort((a, b) => a.clip.start - b.clip.start);
  for (const item of ordered) {
    const still = item.media.kind === "image" || item.media.kind === "color";
    const fade = fadeImages && still && cursor > origin ? 0.45 : 0;
    fitClip(item.clip, 0.5, 0.5, 1);
    item.clip.crossfade = fade;
    item.clip.fadeIn = still && (fade || cursor === origin) ? fade || 0.45 : 0;
    item.clip.fadeOut = still ? fade || 0.45 : 0;
    item.clip.kenBurns = still && item.media.kind === "image";
    item.clip.start = cursor > origin ? Math.max(origin, cursor - fade) : origin;
    track.clips.push(item.clip);
    cursor = item.clip.start + item.clip.duration;
  }
  track.clips.sort((a, b) => a.start - b.start);
}

function rememberHold(clip) {
  if (clip.hold == null) clip.hold = clip.duration;
}

function placeOver(track, items, start, span) {
  const ordered = [...items].sort((a, b) => a.clip.start - b.clip.start);
  const length = Math.max(span, 0.2);
  const each = ordered.length === 1 ? length : length / ordered.length;
  ordered.forEach((item, index) => {
    const offset = index * (ordered.length === 1 ? 0 : each);
    const room = item.media.kind === "video"
      ? Math.max(0.2, (item.media.duration || each) - (item.clip.inPoint || 0))
      : each;
    rememberHold(item.clip);
    item.clip.start = start + offset;
    item.clip.duration = Math.min(each, room);
    fitClip(item.clip, 0.78, 0.72, 0.34);
    item.clip.crossfade = 0;
    item.clip.fadeIn = 0.2;
    item.clip.fadeOut = 0.2;
    item.clip.kenBurns = false;
    track.clips.push(item.clip);
  });
  track.clips.sort((a, b) => a.start - b.start);
}

export function arrangeVisuals(project, mode) {
  const videoTrack = project.tracks.find((track) => track.id === "video");
  const overlay = project.tracks.find((track) => track.id === "overlay");
  const items = [];
  for (const track of [videoTrack, overlay]) {
    for (const clip of [...track.clips]) {
      const media = project.media.find((item) => item.id === clip.mediaId);
      if (!media || (media.kind !== "image" && media.kind !== "video" && media.kind !== "color")) continue;
      items.push({ clip, media, lane: track.id === "video" ? 0 : 1 });
    }
  }
  const pictures = items.filter((item) => item.media.kind !== "video");
  const videos = items.filter((item) => item.media.kind === "video");
  if (!pictures.length || !videos.length) return false;
  for (const item of items) {
    if (item.clip.hold != null) {
      item.clip.duration = item.clip.hold;
      item.clip.hold = null;
    }
  }
  const byTime = (a, b) => a.clip.start - b.clip.start || a.lane - b.lane;
  for (const item of items) detachClip(project, item.clip);
  if (mode === "sequence") {
    packClips(videoTrack, [...pictures, ...videos].sort(byTime), true);
    return true;
  }
  if (mode === "picture-over") {
    packClips(videoTrack, videos, false);
    const start = Math.min(...videos.map((item) => item.clip.start));
    const end = Math.max(...videos.map((item) => item.clip.start + item.clip.duration));
    placeOver(overlay, pictures, start, end - start);
    return true;
  }
  if (mode === "video-over") {
    packClips(videoTrack, pictures, true);
    const start = Math.min(...pictures.map((item) => item.clip.start));
    const end = Math.max(...pictures.map((item) => item.clip.start + item.clip.duration));
    placeOver(overlay, videos, start, end - start);
    return true;
  }
  if (mode === "side") {
    const picture = [...pictures].sort((a, b) => a.clip.start - b.clip.start)[0];
    const video = [...videos].sort((a, b) => a.clip.start - b.clip.start)[0];
    const duration = Math.min(
      picture.clip.duration,
      video.clip.duration,
      video.media.kind === "video" ? video.media.duration || video.clip.duration : picture.clip.duration,
    );
    rememberHold(picture.clip);
    rememberHold(video.clip);
    for (const item of [picture, video]) {
      item.clip.start = 0;
      item.clip.duration = duration;
      item.clip.fadeIn = 0;
      item.clip.fadeOut = 0;
      item.clip.crossfade = 0;
      item.clip.kenBurns = false;
    }
    fitClip(picture.clip, 0.27, 0.5, 0.46);
    fitClip(video.clip, 0.73, 0.5, 0.46);
    videoTrack.clips.push(picture.clip, video.clip);
    const rest = items.filter((item) => item !== picture && item !== video);
    if (rest.length) packClips(videoTrack, rest, true, duration);
    return true;
  }
  return false;
}

export function moveClipToTrack(project, clip, trackId) {
  const destination = project.tracks.find((track) => track.id === trackId);
  if (!destination || (destination.id !== "video" && destination.id !== "overlay")) return false;
  const source = detachClip(project, clip);
  if (!source || source.id === destination.id) {
    source?.clips.push(clip);
    return false;
  }
  const spot = clip.frame || { x: clip.x ?? 0.5, y: clip.y ?? 0.5, scale: clip.scale ?? 1 };
  const full = Math.abs(spot.scale - 1) < 0.02 && Math.abs(spot.x - 0.5) < 0.02 && Math.abs(spot.y - 0.5) < 0.02;
  if (destination.id === "overlay" && full) fitClip(clip, 0.78, 0.72, 0.34);
  else fitClip(clip, spot.x, spot.y, spot.scale);
  clip.crossfade = destination.id === "video" && clip.crossfade ? clip.crossfade : 0;
  destination.clips.push(clip);
  destination.clips.sort((a, b) => a.start - b.start);
  return true;
}

export function splitScreen(project) {
  const track = project.tracks.find((item) => item.id === "video");
  const clips = [...track.clips].sort((a, b) => a.start - b.start);
  if (clips.length < 2) return false;
  const [left, right] = clips;
  right.start = left.start;
  const duration = Math.min(left.duration, right.duration);
  left.duration = duration;
  right.duration = duration;
  fitClip(left, 0.27, 0.5, 0.46);
  fitClip(right, 0.73, 0.5, 0.46);
  project.selectedClipId = right.id;
  return true;
}

export function splitSelected(project, time = project.playhead) {
  const found = findClip(project, project.selectedClipId);
  if (!found) return false;
  const { track, clip } = found;
  const local = time - clip.start;
  if (local < 0.15 || clip.duration - local < 0.15) return false;
  const right = makeClip({
    ...clip,
    id: crypto.randomUUID(),
    start: time,
    inPoint: clip.inPoint + local * clip.speed,
    duration: clip.duration - local,
    fadeIn: 0,
  });
  clip.duration = local;
  clip.fadeOut = 0;
  track.clips.push(right);
  track.clips.sort((a, b) => a.start - b.start);
  project.selectedClipId = right.id;
  return true;
}

export function duplicateSelected(project) {
  const found = findClip(project, project.selectedClipId);
  if (!found) return false;
  placeClip(project, found.track, makeClip({
    ...found.clip,
    id: crypto.randomUUID(),
    start: found.clip.start + found.clip.duration,
  }));
  return true;
}

export function detachAudio(project) {
  const found = findClip(project, project.selectedClipId);
  if (!found || found.track.type !== "video") return false;
  const media = project.media.find((item) => item.id === found.clip.mediaId);
  if (!media || media.kind !== "video") return false;
  const audioTrack = project.tracks.find((track) => track.id === "audio");
  placeClip(project, audioTrack, makeClip({
    ...found.clip,
    id: crypto.randomUUID(),
  }));
  found.clip.volume = 0;
  return true;
}

export function deleteSelected(project) {
  const found = findClip(project, project.selectedClipId);
  if (!found) return false;
  found.track.clips = found.track.clips.filter((clip) => clip.id !== found.clip.id);
  project.selectedClipId = null;
  return true;
}

export function moveClip(clip, start) {
  clip.start = Math.max(0, start);
}

export function trimLeft(clip, nextStart, limit) {
  const speed = clip.speed || 1;
  const delta = nextStart - clip.start;
  let start = nextStart;
  let inPoint = clip.inPoint + delta * speed;
  let duration = clip.duration - delta;
  if (inPoint < 0) {
    start -= inPoint / speed;
    duration += inPoint / speed;
    inPoint = 0;
  }
  if (start < 0) {
    inPoint -= start * speed;
    duration += start;
    start = 0;
  }
  duration = Math.min(duration, (limit - inPoint) / speed);
  if (duration < 0.2 || inPoint < 0) return;
  clip.hold = null;
  clip.start = start;
  clip.inPoint = inPoint;
  clip.duration = duration;
}

export function trimRight(clip, nextDuration, limit) {
  const speed = clip.speed || 1;
  const max = (limit - clip.inPoint) / speed;
  clip.hold = null;
  clip.duration = Math.min(Math.max(0.2, nextDuration), max);
}

export function setSpeed(clip, speed, limit) {
  clip.speed = Math.min(4, Math.max(0.25, speed));
  const max = (limit - clip.inPoint) / clip.speed;
  if (clip.duration > max) clip.duration = Math.max(0.2, max);
}

export function envelope(clip, time) {
  const local = time - clip.start;
  let value = 1;
  if (clip.fadeIn > 0 && local < clip.fadeIn) value *= local / clip.fadeIn;
  const tail = clip.duration - local;
  if (clip.fadeOut > 0 && tail < clip.fadeOut) value *= Math.max(0, tail) / clip.fadeOut;
  return Math.max(0, Math.min(1, value));
}

export function opacityAt(clip, time) {
  return Math.max(0, Math.min(1, (clip.opacity ?? 1) * envelope(clip, time)));
}

export function makeWavTone(seconds = 8, frequency = 440) {
  const sampleRate = 22050;
  const count = Math.floor(sampleRate * seconds);
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const write = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + count * 2, true);
  write(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i += 1) {
    const sample = Math.sin((2 * Math.PI * frequency * i) / sampleRate) * 0.2;
    view.setInt16(44 + i * 2, sample * 0x7fff, true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
}

export function formatTime(seconds) {
  const safe = Math.max(0, seconds);
  const minutes = Math.floor(safe / 60);
  const whole = Math.floor(safe % 60);
  const frames = Math.floor((safe % 1) * 100);
  return `${String(minutes).padStart(2, "0")}:${String(whole).padStart(2, "0")}.${String(frames).padStart(2, "0")}`;
}
