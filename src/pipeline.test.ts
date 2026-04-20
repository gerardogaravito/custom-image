import { describe, it, expect } from 'vitest';
import { apply } from './pipeline';
import type { State } from './types';
import { defaultAdjust, defaultCurves } from './types';

type Pixel = [number, number, number, number];

function makeImage(w: number, h: number, fill: (x: number, y: number) => Pixel): ImageData {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fill(x, y);
      const i = (y * w + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return new ImageData(data, w, h);
}

function solid(w: number, h: number, p: Pixel): ImageData {
  return makeImage(w, h, () => p);
}

function defaultState(): State {
  return { adjust: defaultAdjust(), curves: defaultCurves() };
}

function avgChannel(img: ImageData, ch: 0 | 1 | 2 | 3): number {
  let sum = 0;
  let n = 0;
  for (let i = ch; i < img.data.length; i += 4) { sum += img.data[i]; n++; }
  return sum / n;
}

function variance(img: ImageData, ch: 0 | 1 | 2): number {
  const mean = avgChannel(img, ch);
  let s = 0;
  let n = 0;
  for (let i = ch; i < img.data.length; i += 4) { s += (img.data[i] - mean) ** 2; n++; }
  return s / n;
}

describe('apply — invariants', () => {
  it('preserves output dimensions', () => {
    const out = apply(makeImage(8, 4, () => [50, 100, 150, 255]), defaultState());
    expect(out.width).toBe(8);
    expect(out.height).toBe(4);
    expect(out.data).toHaveLength(8 * 4 * 4);
  });

  it('is the identity for the default state', () => {
    const src = makeImage(4, 4, (x, y) => [x * 30, y * 50, 80, 200]);
    const out = apply(src, defaultState());
    expect(Array.from(out.data)).toEqual(Array.from(src.data));
  });

  it('does not mutate the input image data', () => {
    const src = makeImage(4, 4, (x, y) => [x * 30, y * 50, 80, 200]);
    const snapshot = Array.from(src.data);
    const s = defaultState();
    s.adjust.exposure = 50;
    s.adjust.brightness = 30;
    apply(src, s);
    expect(Array.from(src.data)).toEqual(snapshot);
  });

  it('preserves alpha under any combination of adjustments', () => {
    const src = makeImage(4, 4, (x, y) => [x * 60, y * 60, 120, 137]);
    const s = defaultState();
    s.adjust.exposure = 50;
    s.adjust.brightness = 40;
    s.adjust.contrast = 80;
    s.adjust.saturation = -100;
    s.adjust.highlights = -50;
    s.adjust.blacks = 50;
    s.adjust.denoise = 100;
    s.adjust.noise = 100;
    s.curves.m = [{ x: 0, y: 100 }, { x: 255, y: 200 }];
    const out = apply(src, s);
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(137);
  });

  it('clamps every channel to [0, 255] under saturating inputs', () => {
    const src = solid(4, 4, [10, 10, 10, 255]);
    const s = defaultState();
    s.adjust.exposure = 100;
    s.adjust.brightness = 100;
    const out = apply(src, s);
    for (let i = 0; i < out.data.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        expect(out.data[i + c]).toBeGreaterThanOrEqual(0);
        expect(out.data[i + c]).toBeLessThanOrEqual(255);
      }
    }
  });
});

describe('apply — exposure', () => {
  it.each([10, 50, 100])('exposure %i brightens', (val) => {
    const out = apply(solid(4, 4, [80, 80, 80, 255]), { ...defaultState(), adjust: { ...defaultAdjust(), exposure: val } });
    expect(avgChannel(out, 0)).toBeGreaterThan(80);
  });

  it.each([-10, -50, -100])('exposure %i darkens', (val) => {
    const out = apply(solid(4, 4, [180, 180, 180, 255]), { ...defaultState(), adjust: { ...defaultAdjust(), exposure: val } });
    expect(avgChannel(out, 0)).toBeLessThan(180);
  });
});

describe('apply — brightness', () => {
  it('positive brightness lifts pixels', () => {
    const s = defaultState(); s.adjust.brightness = 50;
    const out = apply(solid(4, 4, [100, 100, 100, 255]), s);
    expect(avgChannel(out, 0)).toBeGreaterThan(100);
  });

  it('negative brightness drops pixels', () => {
    const s = defaultState(); s.adjust.brightness = -50;
    const out = apply(solid(4, 4, [150, 150, 150, 255]), s);
    expect(avgChannel(out, 0)).toBeLessThan(150);
  });
});

describe('apply — contrast', () => {
  it('positive contrast pushes shadows down and highlights up around 128', () => {
    const s = defaultState(); s.adjust.contrast = 80;
    expect(avgChannel(apply(solid(2, 2, [60, 60, 60, 255]), s), 0)).toBeLessThan(60);
    expect(avgChannel(apply(solid(2, 2, [200, 200, 200, 255]), s), 0)).toBeGreaterThan(200);
  });

  it('contrast leaves the midpoint approximately unchanged', () => {
    const s = defaultState(); s.adjust.contrast = 80;
    const out = apply(solid(2, 2, [128, 128, 128, 255]), s);
    expect(avgChannel(out, 0)).toBe(128);
  });
});

describe('apply — saturation', () => {
  it('saturation = -100 produces grayscale (R = G = B per pixel)', () => {
    const src = makeImage(8, 8, (x, y) => [x * 30, y * 30, 200, 255]);
    const s = defaultState(); s.adjust.saturation = -100;
    const out = apply(src, s);
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(out.data[i + 1]);
      expect(out.data[i + 1]).toBe(out.data[i + 2]);
    }
  });

  it('positive saturation widens the color spread', () => {
    const src = makeImage(8, 8, (x) => [120 + x * 5, 130 - x * 3, 110 + x * 2, 255]);
    const baseSpread = variance(src, 0) + variance(src, 1) + variance(src, 2);
    const s = defaultState(); s.adjust.saturation = 80;
    const out = apply(src, s);
    const newSpread = variance(out, 0) + variance(out, 1) + variance(out, 2);
    expect(newSpread).toBeGreaterThan(baseSpread);
  });
});

describe('apply — highlights and blacks (luma-weighted)', () => {
  it('positive highlights only lifts bright pixels, leaves shadows almost intact', () => {
    const dark = solid(2, 2, [40, 40, 40, 255]);
    const bright = solid(2, 2, [220, 220, 220, 255]);
    const s = defaultState(); s.adjust.highlights = 100;
    const darkAvg = avgChannel(apply(dark, s), 0);
    const brightAvg = avgChannel(apply(bright, s), 0);
    expect(Math.abs(darkAvg - 40)).toBeLessThanOrEqual(1);
    expect(brightAvg).toBeGreaterThan(220);
  });

  it('positive blacks only lifts dark pixels, leaves highlights almost intact', () => {
    const dark = solid(2, 2, [30, 30, 30, 255]);
    const bright = solid(2, 2, [220, 220, 220, 255]);
    const s = defaultState(); s.adjust.blacks = 100;
    const darkAvg = avgChannel(apply(dark, s), 0);
    const brightAvg = avgChannel(apply(bright, s), 0);
    expect(darkAvg).toBeGreaterThan(30);
    expect(Math.abs(brightAvg - 220)).toBeLessThanOrEqual(1);
  });
});

describe('apply — curves', () => {
  it('flat master curve overrides all earlier adjustments', () => {
    const src = makeImage(4, 4, (x, y) => [x * 50, y * 60, 90, 255]);
    const s = defaultState();
    s.adjust.exposure = 100;
    s.adjust.brightness = -100;
    s.curves.m = [{ x: 0, y: 64 }, { x: 255, y: 64 }];
    const out = apply(src, s);
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(64);
      expect(out.data[i + 1]).toBe(64);
      expect(out.data[i + 2]).toBe(64);
    }
  });

  it('per-channel curves only affect their own channel', () => {
    const src = solid(4, 4, [100, 100, 100, 255]);
    const s = defaultState();
    s.curves.r = [{ x: 0, y: 200 }, { x: 255, y: 200 }];
    const out = apply(src, s);
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(200);
      expect(out.data[i + 1]).toBe(100);
      expect(out.data[i + 2]).toBe(100);
    }
  });

  it('master curve runs before per-channel (per-channel sees corrected values)', () => {
    // master makes everything 200, then r-curve flattens r to 50.
    const s = defaultState();
    s.curves.m = [{ x: 0, y: 200 }, { x: 255, y: 200 }];
    s.curves.r = [{ x: 0, y: 50 }, { x: 255, y: 50 }];
    const out = apply(solid(4, 4, [10, 10, 10, 255]), s);
    expect(out.data[0]).toBe(50);
    expect(out.data[1]).toBe(200);
    expect(out.data[2]).toBe(200);
  });
});

describe('apply — noise', () => {
  it('noise reduce (denoise) reduces variance on a high-frequency input', () => {
    // Random-ish input with high local variance
    let seed = 1;
    const rand = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const src = makeImage(32, 32, () => {
      const v = Math.floor(rand() * 256);
      return [v, v, v, 255];
    });
    const s = defaultState(); s.adjust.denoise = 100;
    const out = apply(src, s);
    expect(variance(out, 0)).toBeLessThan(variance(src, 0));
  });

  it('noise add perturbs the vast majority of pixels', () => {
    const src = solid(16, 16, [128, 128, 128, 255]);
    const s = defaultState(); s.adjust.noise = 50;
    const out = apply(src, s);
    let differing = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i] !== 128 || out.data[i + 1] !== 128 || out.data[i + 2] !== 128) differing++;
    }
    expect(differing).toBeGreaterThan((out.data.length / 4) * 0.9);
  });

  it('noiseSat = 0 produces monochrome noise (R = G = B perturbation)', () => {
    const src = solid(32, 32, [128, 128, 128, 255]);
    const s = defaultState();
    s.adjust.noise = 50;
    s.adjust.noiseSat = 0;
    const out = apply(src, s);
    for (let i = 0; i < out.data.length; i += 4) {
      expect(out.data[i]).toBe(out.data[i + 1]);
      expect(out.data[i + 1]).toBe(out.data[i + 2]);
    }
  });

  it('noiseSat = 100 produces colored noise (channels differ)', () => {
    const src = solid(32, 32, [128, 128, 128, 255]);
    const s = defaultState();
    s.adjust.noise = 50;
    s.adjust.noiseSat = 100;
    const out = apply(src, s);
    let colored = 0;
    for (let i = 0; i < out.data.length; i += 4) {
      if (out.data[i] !== out.data[i + 1] || out.data[i + 1] !== out.data[i + 2]) colored++;
    }
    expect(colored).toBeGreaterThan((out.data.length / 4) * 0.9);
  });
});
