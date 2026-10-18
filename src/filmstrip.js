function once(element, event) {
  return new Promise((resolve, reject) => {
    const ok = () => {
      element.removeEventListener("error", bad);
      resolve();
    };
    const bad = () => {
      element.removeEventListener(event, ok);
      reject(new Error("Could not read media"));
    };
    element.addEventListener(event, ok, { once: true });
    element.addEventListener("error", bad, { once: true });
  });
}

export async function makeFilmstrip(url, duration) {
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "auto";
  video.src = url;
  await once(video, "loadeddata");
  const count = Math.max(4, Math.min(16, Math.round((duration || video.duration || 4) / 2)));
  const frame = document.createElement("canvas");
  frame.width = 96;
  frame.height = 54;
  const sprite = document.createElement("canvas");
  sprite.width = frame.width * count;
  sprite.height = frame.height;
  const frameCtx = frame.getContext("2d");
  const spriteCtx = sprite.getContext("2d");
  const length = Number.isFinite(video.duration) ? video.duration : duration;
  for (let index = 0; index < count; index += 1) {
    const at = length * ((index + 0.5) / count);
    if (Math.abs(video.currentTime - at) > 0.05) {
      video.currentTime = Math.min(at, Math.max(0, length - 0.05));
      await once(video, "seeked");
    }
    frameCtx.drawImage(video, 0, 0, frame.width, frame.height);
    spriteCtx.drawImage(frame, index * frame.width, 0);
  }
  const width = video.videoWidth;
  const height = video.videoHeight;
  video.src = "";
  return { url: sprite.toDataURL("image/jpeg", 0.72), width, height };
}

export async function findSilence(url) {
  const context = new AudioContext();
  try {
    const bytes = await (await fetch(url)).arrayBuffer();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    const channel = buffer.getChannelData(0);
    const win = Math.max(1, Math.floor(buffer.sampleRate * 0.2));
    const marks = [];
    let quiet = false;
    for (let index = 0; index < channel.length; index += win) {
      let sum = 0;
      let count = 0;
      for (let offset = 0; offset < win && index + offset < channel.length; offset += 16) {
        sum += Math.abs(channel[index + offset] || 0);
        count += 1;
      }
      const silent = count > 0 && sum / count < 0.008;
      if (silent && !quiet) marks.push(index / buffer.sampleRate);
      quiet = silent;
    }
    return marks;
  } catch {
    return [];
  } finally {
    await context.close();
  }
}

export async function makeWaveform(url) {
  const context = new AudioContext();
  try {
    const bytes = await (await fetch(url)).arrayBuffer();
    const buffer = await context.decodeAudioData(bytes.slice(0));
    const channel = buffer.getChannelData(0);
    const samples = 480;
    const canvas = document.createElement("canvas");
    canvas.width = samples;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    const block = Math.max(1, Math.floor(channel.length / samples));
    ctx.fillStyle = "rgba(244, 239, 230, 0.9)";
    for (let index = 0; index < samples; index += 1) {
      let peak = 0;
      const start = index * block;
      for (let offset = 0; offset < block; offset += 8) peak = Math.max(peak, Math.abs(channel[start + offset] || 0));
      const height = Math.max(1, peak * canvas.height);
      ctx.fillRect(index, (canvas.height - height) / 2, 1, height);
    }
    return canvas.toDataURL("image/png");
  } catch {
    return null;
  } finally {
    await context.close();
  }
}
