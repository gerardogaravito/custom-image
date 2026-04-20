import { describe, it, expect } from 'vitest';
import { buildLUT, isIdentity } from './curves';
import type { Point } from './types';

const IDENTITY: Point[] = [{ x: 0, y: 0 }, { x: 255, y: 255 }];

describe('isIdentity', () => {
  it('is true for the canonical [{0,0},{255,255}] curve', () => {
    expect(isIdentity(IDENTITY)).toBe(true);
  });

  it.each<{ name: string; pts: Point[] }>([
    { name: 'first endpoint y moved', pts: [{ x: 0, y: 10 }, { x: 255, y: 255 }] },
    { name: 'last endpoint y moved', pts: [{ x: 0, y: 0 }, { x: 255, y: 200 }] },
    { name: 'first endpoint x moved', pts: [{ x: 5, y: 0 }, { x: 255, y: 255 }] },
    { name: 'extra middle control point', pts: [{ x: 0, y: 0 }, { x: 128, y: 128 }, { x: 255, y: 255 }] },
    { name: 'empty', pts: [] },
    { name: 'single point', pts: [{ x: 0, y: 0 }] },
    { name: 'three points', pts: [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 255, y: 255 }] },
  ])('is false: $name', ({ pts }) => {
    expect(isIdentity(pts)).toBe(false);
  });
});

describe('buildLUT', () => {
  describe('shape', () => {
    it('always returns exactly 256 entries', () => {
      expect(buildLUT(IDENTITY)).toHaveLength(256);
      expect(buildLUT([])).toHaveLength(256);
      expect(buildLUT([{ x: 50, y: 50 }])).toHaveLength(256);
    });

    it('returns a Uint8ClampedArray (values guaranteed 0..255)', () => {
      const lut = buildLUT([{ x: 0, y: -1000 }, { x: 255, y: 9999 }]);
      expect(lut).toBeInstanceOf(Uint8ClampedArray);
      for (const v of lut) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(255);
      }
    });
  });

  describe('degenerate inputs', () => {
    it('with no points returns identity', () => {
      const lut = buildLUT([]);
      for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i);
    });

    it('with one point returns a constant LUT', () => {
      const lut = buildLUT([{ x: 100, y: 42 }]);
      for (let i = 0; i < 256; i++) expect(lut[i]).toBe(42);
    });

    it('with two points sharing x does not crash and produces a valid LUT', () => {
      // dx fallback (|| 1) keeps division safe
      const lut = buildLUT([{ x: 128, y: 50 }, { x: 128, y: 200 }]);
      expect(lut).toHaveLength(256);
    });
  });

  describe('identity mapping', () => {
    it('with identity points returns lut[i] === i', () => {
      const lut = buildLUT(IDENTITY);
      for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i);
    });

    it('survives unsorted input via internal sort', () => {
      const sorted = buildLUT([{ x: 0, y: 0 }, { x: 128, y: 200 }, { x: 255, y: 255 }]);
      const unsorted = buildLUT([{ x: 255, y: 255 }, { x: 0, y: 0 }, { x: 128, y: 200 }]);
      expect(Array.from(unsorted)).toEqual(Array.from(sorted));
    });
  });

  describe('endpoint clamping', () => {
    it('clamps left of the first control point to its y', () => {
      const lut = buildLUT([{ x: 50, y: 30 }, { x: 200, y: 220 }]);
      for (let i = 0; i <= 50; i++) expect(lut[i]).toBe(30);
    });

    it('clamps right of the last control point to its y', () => {
      const lut = buildLUT([{ x: 50, y: 30 }, { x: 200, y: 220 }]);
      for (let i = 200; i < 256; i++) expect(lut[i]).toBe(220);
    });
  });

  describe('Fritsch-Carlson monotonicity', () => {
    const monotonicCases: Point[][] = [
      [{ x: 0, y: 0 }, { x: 64, y: 40 }, { x: 128, y: 128 }, { x: 192, y: 215 }, { x: 255, y: 255 }],
      [{ x: 0, y: 0 }, { x: 32, y: 100 }, { x: 200, y: 200 }, { x: 255, y: 255 }],
      [{ x: 0, y: 50 }, { x: 128, y: 80 }, { x: 255, y: 240 }],
      [{ x: 0, y: 0 }, { x: 255, y: 255 }],
    ];

    it.each(monotonicCases)('preserves monotonicity for case #%#', (...points) => {
      const pts = points as unknown as Point[];
      const lut = buildLUT(pts);
      for (let i = 1; i < 256; i++) {
        expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
      }
    });

    it('does not overshoot when control points are flat then steep', () => {
      // A naive cubic spline would overshoot here; Fritsch-Carlson should not.
      const lut = buildLUT([{ x: 0, y: 100 }, { x: 100, y: 100 }, { x: 200, y: 200 }, { x: 255, y: 200 }]);
      for (const v of lut) {
        expect(v).toBeGreaterThanOrEqual(100);
        expect(v).toBeLessThanOrEqual(200);
      }
    });
  });

  describe('semantic shape', () => {
    const sCurve: Point[] = [
      { x: 0, y: 0 },
      { x: 64, y: 40 },
      { x: 128, y: 128 },
      { x: 192, y: 215 },
      { x: 255, y: 255 },
    ];

    it('S-curve crushes shadows below the midpoint', () => {
      const lut = buildLUT(sCurve);
      expect(lut[64]).toBeLessThan(64);
    });

    it('S-curve lifts highlights above the midpoint', () => {
      const lut = buildLUT(sCurve);
      expect(lut[192]).toBeGreaterThan(192);
    });

    it('S-curve passes through the exact midpoint', () => {
      const lut = buildLUT(sCurve);
      expect(lut[128]).toBe(128);
    });

    it('inverted curve [{0,255},{255,0}] is strictly decreasing', () => {
      const lut = buildLUT([{ x: 0, y: 255 }, { x: 255, y: 0 }]);
      for (let i = 1; i < 256; i++) expect(lut[i]).toBeLessThanOrEqual(lut[i - 1]);
      expect(lut[0]).toBe(255);
      expect(lut[255]).toBe(0);
    });
  });
});
