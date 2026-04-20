import { describe, it, expect } from 'vitest';
import {
  type CropBox,
  anchorOf,
  cropImageData,
  fitToAspect,
  fullBox,
  moveBox,
  parseAspect,
  resizeBox,
} from './crop';

const BOUNDS = { w: 1000, h: 800 };
const BOX: CropBox = { x: 100, y: 100, w: 600, h: 400 };

describe('parseAspect', () => {
  it.each<[string, number]>([
    ['1:1', 1],
    ['4:5', 0.8],
    ['16:9', 16 / 9],
    ['3:2', 1.5],
  ])('%s → %s', (s, expected) => {
    expect(parseAspect(s)).toBeCloseTo(expected, 6);
  });

  it.each(['free', 'original', '0:1', '1:0', 'abc', ''])('returns null for %s', (s) => {
    expect(parseAspect(s)).toBeNull();
  });
});

describe('fullBox', () => {
  it('returns the full bounds at origin', () => {
    expect(fullBox(BOUNDS)).toEqual({ x: 0, y: 0, w: 1000, h: 800 });
  });
});

describe('anchorOf', () => {
  it.each<[Parameters<typeof anchorOf>[0], { x: number; y: number }]>([
    ['nw', { x: 700, y: 500 }],
    ['ne', { x: 100, y: 500 }],
    ['sw', { x: 700, y: 100 }],
    ['se', { x: 100, y: 100 }],
    ['n',  { x: 400, y: 500 }],
    ['s',  { x: 400, y: 100 }],
    ['w',  { x: 700, y: 300 }],
    ['e',  { x: 100, y: 300 }],
  ])('handle %s → opposite anchor', (handle, expected) => {
    expect(anchorOf(handle, BOX)).toEqual(expected);
  });
});

describe('moveBox', () => {
  it('moves within bounds', () => {
    expect(moveBox(BOX, 50, -30, BOUNDS)).toEqual({ x: 150, y: 70, w: 600, h: 400 });
  });

  it('clamps to the right/bottom', () => {
    const moved = moveBox(BOX, 9999, 9999, BOUNDS);
    expect(moved).toEqual({ x: BOUNDS.w - BOX.w, y: BOUNDS.h - BOX.h, w: 600, h: 400 });
  });

  it('clamps to the left/top', () => {
    const moved = moveBox(BOX, -9999, -9999, BOUNDS);
    expect(moved).toEqual({ x: 0, y: 0, w: 600, h: 400 });
  });

  it('preserves dimensions', () => {
    const moved = moveBox(BOX, 7, 13, BOUNDS);
    expect(moved.w).toBe(BOX.w);
    expect(moved.h).toBe(BOX.h);
  });
});

describe('resizeBox — free mode (no aspect)', () => {
  it('SE corner: dragging cursor enlarges from NW anchor', () => {
    const out = resizeBox('se', { x: 800, y: 600 }, BOX, BOUNDS, null);
    expect(out).toEqual({ x: 100, y: 100, w: 700, h: 500 });
  });

  it('NW corner: dragging cursor shrinks from SE anchor', () => {
    const out = resizeBox('nw', { x: 200, y: 200 }, BOX, BOUNDS, null);
    expect(out).toEqual({ x: 200, y: 200, w: 500, h: 300 });
  });

  it('N edge: only y/h change, x/w preserved', () => {
    const out = resizeBox('n', { x: 9999, y: 50 }, BOX, BOUNDS, null);
    expect(out.x).toBe(100);
    expect(out.w).toBe(600);
    expect(out.y).toBe(50);
    expect(out.h).toBe(450);
  });

  it('E edge: only x/w change, y/h preserved', () => {
    const out = resizeBox('e', { x: 900, y: 9999 }, BOX, BOUNDS, null);
    expect(out.y).toBe(100);
    expect(out.h).toBe(400);
    expect(out.w).toBe(800);
  });

  it('clamps to bounds when cursor goes outside', () => {
    const out = resizeBox('se', { x: 5000, y: 5000 }, BOX, BOUNDS, null);
    expect(out.x + out.w).toBeLessThanOrEqual(BOUNDS.w);
    expect(out.y + out.h).toBeLessThanOrEqual(BOUNDS.h);
  });

  it('enforces a minimum size', () => {
    const out = resizeBox('se', { x: 100, y: 100 }, BOX, BOUNDS, null);
    expect(out.w).toBeGreaterThanOrEqual(20);
    expect(out.h).toBeGreaterThanOrEqual(20);
  });
});

describe('resizeBox — with aspect lock', () => {
  it('SE corner with 1:1 aspect produces a square', () => {
    const out = resizeBox('se', { x: 600, y: 9999 }, BOX, BOUNDS, 1);
    expect(out.w).toBeCloseTo(out.h, 1);
  });

  it('SE corner with 16:9 aspect: ratio preserved', () => {
    const out = resizeBox('se', { x: 800, y: 800 }, BOX, BOUNDS, 16 / 9);
    expect(out.w / out.h).toBeCloseTo(16 / 9, 2);
  });

  it('horizontal edge keeps the box centered horizontally on the original center', () => {
    const cx = BOX.x + BOX.w / 2;
    const out = resizeBox('s', { x: 9999, y: 700 }, BOX, BOUNDS, 1);
    expect(out.x + out.w / 2).toBeCloseTo(cx, 1);
  });

  it('vertical edge keeps the box centered vertically on the original center', () => {
    const cy = BOX.y + BOX.h / 2;
    const out = resizeBox('e', { x: 900, y: 9999 }, BOX, BOUNDS, 1);
    expect(out.y + out.h / 2).toBeCloseTo(cy, 1);
  });
});

describe('fitToAspect', () => {
  it('returns the box unchanged in free mode', () => {
    expect(fitToAspect(BOX, null, BOUNDS)).toEqual(BOX);
  });

  it('produces a box with the requested aspect', () => {
    const out = fitToAspect(BOX, 16 / 9, BOUNDS);
    expect(out.w / out.h).toBeCloseTo(16 / 9, 4);
  });

  it('keeps the original center when possible', () => {
    const cx = BOX.x + BOX.w / 2;
    const cy = BOX.y + BOX.h / 2;
    const out = fitToAspect(BOX, 1, BOUNDS);
    expect(out.x + out.w / 2).toBeCloseTo(cx, 1);
    expect(out.y + out.h / 2).toBeCloseTo(cy, 1);
  });

  it('shrinks to fit when the ratio is wider than current box', () => {
    const tall: CropBox = { x: 0, y: 0, w: 100, h: 800 };
    const out = fitToAspect(tall, 4, { w: 1000, h: 800 });
    expect(out.w / out.h).toBeCloseTo(4, 2);
    expect(out.w).toBeLessThanOrEqual(1000);
    expect(out.h).toBeLessThanOrEqual(800);
  });

  it('respects bounds for very narrow ratios', () => {
    const out = fitToAspect(BOX, 0.1, BOUNDS);
    expect(out.x).toBeGreaterThanOrEqual(0);
    expect(out.y).toBeGreaterThanOrEqual(0);
    expect(out.x + out.w).toBeLessThanOrEqual(BOUNDS.w);
    expect(out.y + out.h).toBeLessThanOrEqual(BOUNDS.h);
  });
});

describe('cropImageData', () => {
  function makeImage(w: number, h: number, fill: (x: number, y: number) => [number, number, number, number]): ImageData {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b, a] = fill(x, y);
        const i = (y * w + x) * 4;
        data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = a;
      }
    }
    return new ImageData(data, w, h);
  }

  it('returns an image with the box dimensions', () => {
    const src = makeImage(10, 10, () => [0, 0, 0, 255]);
    const out = cropImageData(src, { x: 1, y: 2, w: 4, h: 3 });
    expect(out.width).toBe(4);
    expect(out.height).toBe(3);
  });

  it('copies the right pixels (positional fingerprint)', () => {
    // Each pixel encodes its (x, y) so we can verify positions
    const src = makeImage(10, 10, (x, y) => [x * 10, y * 10, 0, 255]);
    const out = cropImageData(src, { x: 3, y: 4, w: 2, h: 2 });
    // Pixel (0,0) of the crop should be source's (3,4) → R=30, G=40
    expect(out.data[0]).toBe(30);
    expect(out.data[1]).toBe(40);
    // Pixel (1,1) of the crop should be source's (4,5) → R=40, G=50
    const i11 = (1 * out.width + 1) * 4;
    expect(out.data[i11]).toBe(40);
    expect(out.data[i11 + 1]).toBe(50);
  });

  it('rounds non-integer coordinates and clamps to source bounds', () => {
    const src = makeImage(10, 10, () => [255, 0, 0, 255]);
    const out = cropImageData(src, { x: 5.6, y: 5.6, w: 100, h: 100 });
    expect(out.width).toBeLessThanOrEqual(10);
    expect(out.height).toBeLessThanOrEqual(10);
    expect(out.width).toBeGreaterThanOrEqual(1);
  });

  it('preserves alpha', () => {
    const src = makeImage(8, 8, (x) => [x * 30, 0, 0, 137]);
    const out = cropImageData(src, { x: 0, y: 0, w: 4, h: 4 });
    for (let i = 3; i < out.data.length; i += 4) expect(out.data[i]).toBe(137);
  });
});
