import type { State } from './types';
import { buildLUT, isIdentity } from './curves';

// 3x3 box blur, strength 0..1 mixes with original.
function boxBlur(src: ImageData, strength: number): ImageData {
  if (strength <= 0) return src;
  const { width: w, height: h, data } = src;
  const out = new Uint8ClampedArray(data.length);
  const k = strength;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const i = (yy * w + xx) * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
      }
      const i = (y * w + x) * 4;
      out[i]     = data[i]     * (1 - k) + (r / n) * k;
      out[i + 1] = data[i + 1] * (1 - k) + (g / n) * k;
      out[i + 2] = data[i + 2] * (1 - k) + (b / n) * k;
      out[i + 3] = data[i + 3];
    }
  }
  return new ImageData(out, w, h);
}

export function apply(src: ImageData, s: State): ImageData {
  const { width: w, height: h } = src;
  const inBuf = src.data;
  let buf = new Uint8ClampedArray(inBuf);

  const a = s.adjust;
  const exposure = Math.pow(2, a.exposure / 50);   // stops-ish
  const brightness = a.brightness * 1.27;           // -127..127
  const contrast = 1 + a.contrast / 100;            // 0..2
  const hi = a.highlights / 100;                    // -1..1
  const bl = a.blacks / 100;                        // -1..1
  const sat = 1 + a.saturation / 100;               // 0..2

  const lutM = buildLUT(s.curves.m);
  const lutR = buildLUT(s.curves.r);
  const lutG = buildLUT(s.curves.g);
  const lutB = buildLUT(s.curves.b);
  const hasM = !isIdentity(s.curves.m);
  const hasR = !isIdentity(s.curves.r);
  const hasG = !isIdentity(s.curves.g);
  const hasB = !isIdentity(s.curves.b);

  for (let i = 0; i < buf.length; i += 4) {
    let r = inBuf[i], g = inBuf[i + 1], b = inBuf[i + 2];

    // exposure
    r *= exposure; g *= exposure; b *= exposure;
    // brightness
    r += brightness; g += brightness; b += brightness;
    // contrast around 128
    r = (r - 128) * contrast + 128;
    g = (g - 128) * contrast + 128;
    b = (b - 128) * contrast + 128;

    // highlights: lift/lower bright pixels (luma-weighted)
    if (hi !== 0) {
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const wgt = Math.max(0, l - 0.5) * 2; // 0..1 for l in 0.5..1
      const d = hi * 80 * wgt;
      r += d; g += d; b += d;
    }
    // blacks: lift/crush dark pixels
    if (bl !== 0) {
      const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const wgt = Math.max(0, 0.5 - l) * 2;
      const d = bl * 80 * wgt;
      r += d; g += d; b += d;
    }

    // saturation
    if (sat !== 1) {
      const gray = 0.2989 * r + 0.5870 * g + 0.1140 * b;
      r = gray + (r - gray) * sat;
      g = gray + (g - gray) * sat;
      b = gray + (b - gray) * sat;
    }

    r = r < 0 ? 0 : r > 255 ? 255 : r;
    g = g < 0 ? 0 : g > 255 ? 255 : g;
    b = b < 0 ? 0 : b > 255 ? 255 : b;

    // curves: master, then per-channel
    if (hasM) { r = lutM[r | 0]; g = lutM[g | 0]; b = lutM[b | 0]; }
    if (hasR) r = lutR[r | 0];
    if (hasG) g = lutG[g | 0];
    if (hasB) b = lutB[b | 0];

    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b; buf[i + 3] = inBuf[i + 3];
  }

  const outBuf = new Uint8ClampedArray(buf.buffer.slice(0));
  let out = new ImageData(outBuf, w, h);

  // noise reduce (3x3 blur mix)
  if (a.denoise > 0) {
    out = boxBlur(out, a.denoise / 100);
  }

  // noise add (color + sat)
  if (a.noise > 0) {
    const amt = a.noise * 1.27;                    // 0..127
    const colorAmount = a.noiseSat / 100;          // 0..1
    const d = out.data;
    for (let i = 0; i < d.length; i += 4) {
      const mono = (Math.random() - 0.5) * 2 * amt;
      const cR = (Math.random() - 0.5) * 2 * amt;
      const cG = (Math.random() - 0.5) * 2 * amt;
      const cB = (Math.random() - 0.5) * 2 * amt;
      const nR = mono * (1 - colorAmount) + cR * colorAmount;
      const nG = mono * (1 - colorAmount) + cG * colorAmount;
      const nB = mono * (1 - colorAmount) + cB * colorAmount;
      let r = d[i] + nR, g = d[i + 1] + nG, b = d[i + 2] + nB;
      d[i]     = r < 0 ? 0 : r > 255 ? 255 : r;
      d[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
      d[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
    }
  }

  return out;
}
