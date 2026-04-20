export type Point = { x: number; y: number };
export type Channel = 'm' | 'r' | 'g' | 'b';

export type Curves = Record<Channel, Point[]>;

export type Adjust = {
  exposure: number;
  brightness: number;
  contrast: number;
  highlights: number;
  blacks: number;
  saturation: number;
  denoise: number;
  noise: number;
  noiseSat: number;
};

export type State = {
  adjust: Adjust;
  curves: Curves;
};

export const defaultAdjust = (): Adjust => ({
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  blacks: 0,
  saturation: 0,
  denoise: 0,
  noise: 0,
  noiseSat: 50,
});

export const defaultCurves = (): Curves => ({
  m: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  r: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  g: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
  b: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
});
