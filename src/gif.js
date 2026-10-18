function palette332() {
  const colors = new Uint8Array(768);
  for (let index = 0; index < 256; index += 1) {
    const red = (index >> 5) & 7;
    const green = (index >> 2) & 7;
    const blue = index & 3;
    colors[index * 3] = Math.round((red * 255) / 7);
    colors[index * 3 + 1] = Math.round((green * 255) / 7);
    colors[index * 3 + 2] = Math.round((blue * 255) / 3);
  }
  return colors;
}

function indexPixels(data) {
  const indexed = new Uint8Array(data.length / 4);
  for (let pixel = 0, offset = 0; offset < data.length; pixel += 1, offset += 4) {
    indexed[pixel] = ((data[offset] >> 5) << 5) | ((data[offset + 1] >> 5) << 2) | (data[offset + 2] >> 6);
  }
  return indexed;
}

class BitWriter {
  constructor() {
    this.bytes = [];
    this.current = 0;
    this.used = 0;
  }

  write(code, size) {
    this.current |= code << this.used;
    this.used += size;
    while (this.used >= 8) {
      this.bytes.push(this.current & 255);
      this.current >>= 8;
      this.used -= 8;
    }
  }

  finish() {
    if (this.used > 0) this.bytes.push(this.current & 255);
    return Uint8Array.from(this.bytes);
  }
}

function lzw(indices) {
  const clearCode = 256;
  const endCode = 257;
  let codeSize = 9;
  let nextCode = 258;
  const table = new Map();
  const reset = () => {
    table.clear();
    codeSize = 9;
    nextCode = 258;
  };
  const writer = new BitWriter();
  reset();
  writer.write(clearCode, codeSize);
  let phrase = String.fromCharCode(indices[0]);
  for (let index = 1; index < indices.length; index += 1) {
    const next = phrase + String.fromCharCode(indices[index]);
    if (next.length === 1 || table.has(next)) {
      phrase = next;
      continue;
    }
    writer.write(phrase.length === 1 ? phrase.charCodeAt(0) : table.get(phrase), codeSize);
    if (nextCode < 4096) {
      table.set(next, nextCode);
      nextCode += 1;
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize += 1;
    } else {
      writer.write(clearCode, codeSize);
      reset();
    }
    phrase = String.fromCharCode(indices[index]);
  }
  writer.write(phrase.length === 1 ? phrase.charCodeAt(0) : table.get(phrase), codeSize);
  writer.write(endCode, codeSize);
  return writer.finish();
}

function subBlocks(bytes) {
  const parts = [new Uint8Array([8])];
  for (let offset = 0; offset < bytes.length; offset += 255) {
    const block = bytes.subarray(offset, offset + 255);
    const wrapped = new Uint8Array(block.length + 1);
    wrapped[0] = block.length;
    wrapped.set(block, 1);
    parts.push(wrapped);
  }
  parts.push(new Uint8Array([0]));
  return parts;
}

function word(value) {
  return new Uint8Array([value & 255, (value >> 8) & 255]);
}

export function gifHeader(width, height) {
  const header = new Uint8Array(13 + 768);
  header.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]);
  header.set(word(width), 6);
  header.set(word(height), 8);
  header[10] = 0xf7;
  header.set(palette332(), 13);
  const loop = new Uint8Array([
    0x21, 0xff, 0x0b, 0x4e, 0x45, 0x54, 0x53, 0x43, 0x41, 0x50, 0x45, 0x32, 0x2e, 0x30, 0x03, 0x01, 0x00, 0x00, 0x00,
  ]);
  return [header, loop];
}

export function gifFrame(image, width, height, delayCs) {
  const pixels = indexPixels(image.data);
  const compressed = lzw(pixels);
  const control = new Uint8Array([0x21, 0xf9, 0x04, 0x04, delayCs & 255, (delayCs >> 8) & 255, 0x00, 0x00]);
  const descriptor = new Uint8Array(10);
  descriptor[0] = 0x2c;
  descriptor.set(word(width), 5);
  descriptor.set(word(height), 7);
  return [control, descriptor, ...subBlocks(compressed)];
}

export function gifTrailer() {
  return new Uint8Array([0x3b]);
}
