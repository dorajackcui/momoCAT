import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const icoPath = path.join(repoRoot, 'apps', 'desktop', 'build', 'icon.ico');

function parseIcoPngFrames(buffer) {
  assert.equal(buffer.readUInt16LE(0), 0, 'ico reserved field');
  assert.equal(buffer.readUInt16LE(2), 1, 'ico type');
  const count = buffer.readUInt16LE(4);
  const frames = [];

  for (let i = 0; i < count; i += 1) {
    const entryOffset = 6 + i * 16;
    const widthByte = buffer.readUInt8(entryOffset);
    const heightByte = buffer.readUInt8(entryOffset + 1);
    const size = buffer.readUInt32LE(entryOffset + 8);
    const offset = buffer.readUInt32LE(entryOffset + 12);
    const data = buffer.subarray(offset, offset + size);

    assert.deepEqual(
      [...data.subarray(0, 8)],
      [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
      `ico frame ${i} should be PNG encoded`,
    );

    frames.push({
      width: widthByte === 0 ? 256 : widthByte,
      height: heightByte === 0 ? 256 : heightByte,
      data,
    });
  }

  return frames;
}

function decodePngRgba(buffer) {
  assert.deepEqual(
    [...buffer.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'png signature',
  );

  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    offset += 12 + length;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data.readUInt8(8), 8, 'png bit depth');
      colorType = data.readUInt8(9);
      assert.equal(colorType, 6, 'Windows icon PNG frames must preserve RGBA alpha');
      assert.equal(data.readUInt8(12), 0, 'png interlace method');
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  const channels = 4;
  const stride = width * channels;
  const inflated = zlib.inflateSync(Buffer.concat(idatChunks));
  const pixels = Buffer.alloc(width * height * channels);
  let srcOffset = 0;

  for (let y = 0; y < height; y += 1) {
    const filter = inflated.readUInt8(srcOffset);
    srcOffset += 1;
    const row = inflated.subarray(srcOffset, srcOffset + stride);
    srcOffset += stride;
    const outOffset = y * stride;

    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? pixels[outOffset + x - channels] : 0;
      const up = y > 0 ? pixels[outOffset + x - stride] : 0;
      const upperLeft = y > 0 && x >= channels ? pixels[outOffset + x - stride - channels] : 0;
      const value = row.readUInt8(x);

      if (filter === 0) {
        pixels[outOffset + x] = value;
      } else if (filter === 1) {
        pixels[outOffset + x] = (value + left) & 0xff;
      } else if (filter === 2) {
        pixels[outOffset + x] = (value + up) & 0xff;
      } else if (filter === 3) {
        pixels[outOffset + x] = (value + Math.floor((left + up) / 2)) & 0xff;
      } else if (filter === 4) {
        const p = left + up - upperLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upperLeft);
        const predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft;
        pixels[outOffset + x] = (value + predictor) & 0xff;
      } else {
        throw new Error(`Unsupported PNG filter ${filter}`);
      }
    }
  }

  return { width, height, pixels };
}

test('Windows app icon frames keep transparent rounded corners', () => {
  const ico = fs.readFileSync(icoPath);
  const frames = parseIcoPngFrames(ico);

  assert.deepEqual(
    frames.map((frame) => frame.width),
    [16, 32, 48, 64, 128, 256],
  );

  for (const frame of frames) {
    const png = decodePngRgba(frame.data);
    assert.equal(png.width, frame.width);
    assert.equal(png.height, frame.height);
    assert.equal(png.pixels[3], 0, `${frame.width}px icon top-left pixel should be transparent`);
  }
});
