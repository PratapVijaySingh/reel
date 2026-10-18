const CANDIDATES = [
  { id: "mp4", label: "MP4 · H.264", extension: "mp4", mime: "video/mp4;codecs=avc1.640028,mp4a.40.2", kind: "video" },
  { id: "hevc", label: "MP4 · HEVC", extension: "mp4", mime: "video/mp4;codecs=hev1.1.6.L93.B0,mp4a.40.2", kind: "video" },
  { id: "av1-mp4", label: "MP4 · AV1", extension: "mp4", mime: "video/mp4;codecs=av01.0.08M.08,mp4a.40.2", kind: "video" },
  { id: "vp9", label: "WebM · VP9", extension: "webm", mime: "video/webm;codecs=vp9,opus", kind: "video" },
  { id: "vp8", label: "WebM · VP8", extension: "webm", mime: "video/webm;codecs=vp8,opus", kind: "video" },
  { id: "av1-webm", label: "WebM · AV1", extension: "webm", mime: "video/webm;codecs=av01.0.05M.08,opus", kind: "video" },
  { id: "mkv", label: "MKV · VP9", extension: "mkv", mime: "video/x-matroska;codecs=vp9,opus", kind: "video" },
  { id: "m4a", label: "Audio · M4A", extension: "m4a", mime: "audio/mp4", kind: "audio" },
  { id: "weba", label: "Audio · WebM", extension: "weba", mime: "audio/webm;codecs=opus", kind: "audio" },
  { id: "gif", label: "GIF", extension: "gif", mime: "image/gif", kind: "gif" },
];

export function availableFormats() {
  return CANDIDATES.filter((format) => format.kind === "gif" || MediaRecorder.isTypeSupported(format.mime));
}
