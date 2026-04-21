import type { Point, Curves, Channel } from './types';
import { defaultCurves } from './types';

// Monotonic cubic (Fritsch-Carlson) interpolation → 256-entry LUT.
export function buildLUT(points: Point[]): Uint8ClampedArray {
  const pts = [...points].sort((a, b) => a.x - b.x);
  const lut = new Uint8ClampedArray(256);
  const n = pts.length;
  if (n === 0) { for (let i = 0; i < 256; i++) lut[i] = i; return lut; }
  if (n === 1) { for (let i = 0; i < 256; i++) lut[i] = pts[0].y; return lut; }

  const dx: number[] = [];
  const dy: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const xd = pts[i + 1].x - pts[i].x || 1;
    const yd = pts[i + 1].y - pts[i].y;
    dx.push(xd); dy.push(yd); slope.push(yd / xd);
  }
  const m: number[] = new Array(n).fill(0);
  m[0] = slope[0];
  m[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) m[i] = 0;
    else m[i] = (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) { m[i] = 0; m[i + 1] = 0; continue; }
    const a = m[i] / slope[i];
    const b = m[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const t = 3 / Math.sqrt(h);
      m[i] = t * a * slope[i];
      m[i + 1] = t * b * slope[i];
    }
  }

  for (let x = 0; x < 256; x++) {
    if (x <= pts[0].x) { lut[x] = pts[0].y; continue; }
    if (x >= pts[n - 1].x) { lut[x] = pts[n - 1].y; continue; }
    let i = 0;
    while (i < n - 1 && pts[i + 1].x < x) i++;
    const h = dx[i];
    const t = (x - pts[i].x) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    lut[x] = h00 * pts[i].y + h10 * h * m[i] + h01 * pts[i + 1].y + h11 * h * m[i + 1];
  }
  return lut;
}

export function isIdentity(points: Point[]): boolean {
  return points.length === 2 &&
    points[0].x === 0 && points[0].y === 0 &&
    points[1].x === 255 && points[1].y === 255;
}

export type CurvesUI = {
  state: Curves;
  active: Channel;
  onChange: () => void;
  reset: () => void;
  /** Replace the widget's curves with a deep copy of the given snapshot and redraw. */
  setState: (curves: Curves) => void;
};

/* v8 ignore start -- DOM/canvas widget, exercised in the browser */
export function mountCurves(canvas: HTMLCanvasElement, onChange: () => void): CurvesUI {
  const state: Curves = defaultCurves();
  let active: Channel = 'm';
  const ctx = canvas.getContext('2d')!;
  const W = 256, H = 256;
  canvas.width = W; canvas.height = H;

  const channelColor = (c: Channel) =>
    c === 'r' ? '#ff3b30' : c === 'g' ? '#34c759' : c === 'b' ? '#0a84ff' : '#f2f2f2';

  function draw() {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);

    ctx.strokeStyle = '#1e1e1e';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 4; i++) {
      ctx.moveTo((i * W) / 4, 0); ctx.lineTo((i * W) / 4, H);
      ctx.moveTo(0, (i * H) / 4); ctx.lineTo(W, (i * H) / 4);
    }
    ctx.stroke();
    ctx.strokeStyle = '#2a2a2a';
    ctx.beginPath(); ctx.moveTo(0, H); ctx.lineTo(W, 0); ctx.stroke();

    // faded other channels
    (['m', 'r', 'g', 'b'] as Channel[]).forEach((c) => {
      if (c === active) return;
      const lut = buildLUT(state[c]);
      ctx.strokeStyle = channelColor(c) + '40';
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x < 256; x++) {
        const y = H - lut[x];
        if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });

    // active curve
    const lut = buildLUT(state[active]);
    ctx.strokeStyle = channelColor(active);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let x = 0; x < 256; x++) {
      const y = H - lut[x];
      if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // points
    ctx.fillStyle = channelColor(active);
    for (const p of state[active]) {
      ctx.fillRect(p.x - 3, (H - p.y) - 3, 6, 6);
    }
  }

  function toLocal(e: PointerEvent): Point {
    const r = canvas.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 255);
    const y = Math.round((1 - (e.clientY - r.top) / r.height) * 255);
    return { x: Math.max(0, Math.min(255, x)), y: Math.max(0, Math.min(255, y)) };
  }

  let dragging: number | null = null;

  // Hit radius adapts to pointer type. We measure in DISPLAY pixels (not
  // 0–255 curve units) because the canvas is rendered at variable CSS size
  // depending on viewport — a fixed unit-radius would feel chunky on a
  // wide desktop canvas and microscopic on a phone. ~22 px on coarse
  // pointers (finger) sits between Apple HIG's 44 px ideal and the visual
  // size of the 6 px point square — large enough to grab without looking,
  // small enough that adjacent points don't collide. ~10 px on fine
  // pointers (mouse/pen) keeps desktop precision.
  const isCoarse = typeof matchMedia !== 'undefined' &&
    matchMedia('(hover: none) and (pointer: coarse)').matches;
  const hitRadiusPx = isCoarse ? 22 : 10;

  function findHit(e: PointerEvent, pts: Point[]): number {
    const r = canvas.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return -1;
    const sx = r.width / 255;
    const sy = r.height / 255;
    const px = e.clientX - r.left;
    const py = e.clientY - r.top;
    const t2 = hitRadiusPx * hitRadiusPx;
    // iterate last-to-first so points stacked on top (drawn last) win the hit
    for (let i = pts.length - 1; i >= 0; i--) {
      const dx = pts[i].x * sx - px;
      const dy = (255 - pts[i].y) * sy - py;
      if (dx * dx + dy * dy <= t2) return i;
    }
    return -1;
  }

  canvas.addEventListener('pointerdown', (e) => {
    const pts = state[active];
    const idx = findHit(e, pts);
    if (idx >= 0) {
      dragging = idx;
    } else {
      const p = toLocal(e);
      pts.push(p);
      pts.sort((a, b) => a.x - b.x);
      dragging = pts.findIndex((q) => q.x === p.x && q.y === p.y);
      onChange();
      draw();
    }
    // Capture so subsequent move/up events keep targeting the canvas even
    // if the finger drifts outside its bounds. Combined with #curve's
    // `touch-action: none` (style.css) this is what gives the iOS-native
    // "stuck to my finger" feel — the OS can't steal the gesture for a
    // parent scroll mid-drag.
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (dragging === null) return;
    const p = toLocal(e);
    const pts = state[active];
    const isEnd = dragging === 0 || dragging === pts.length - 1;
    if (isEnd) {
      pts[dragging].x = dragging === 0 ? 0 : 255;
      pts[dragging].y = p.y;
    } else {
      const minX = pts[dragging - 1].x + 1;
      const maxX = pts[dragging + 1].x - 1;
      pts[dragging].x = Math.max(minX, Math.min(maxX, p.x));
      pts[dragging].y = p.y;
    }
    onChange();
    draw();
  });

  function endDrag(e: PointerEvent) {
    dragging = null;
    if (canvas.hasPointerCapture?.(e.pointerId)) {
      canvas.releasePointerCapture(e.pointerId);
    }
  }
  canvas.addEventListener('pointerup', endDrag);
  // Defensive: if iOS ever decides to cancel the pointer (e.g. system
  // gesture, incoming call, multi-touch escalation), clear state cleanly
  // so the next pointerdown isn't haunted by a stale `dragging` index.
  // With `touch-action: none` on the canvas this should rarely fire, but
  // not handling it would leave the curve in a half-grabbed state.
  canvas.addEventListener('pointercancel', endDrag);

  canvas.addEventListener('dblclick', (e) => {
    const pts = state[active];
    const idx = findHit(e as unknown as PointerEvent, pts);
    if (idx > 0 && idx < pts.length - 1) {
      pts.splice(idx, 1);
      onChange();
      draw();
    }
  });

  draw();

  return {
    state,
    get active() { return active; },
    set active(c: Channel) { active = c; draw(); },
    onChange,
    reset() {
      const d = defaultCurves();
      (Object.keys(d) as Channel[]).forEach((k) => { state[k] = d[k]; });
      draw();
    },
    setState(newCurves: Curves) {
      (Object.keys(newCurves) as Channel[]).forEach((k) => {
        // Deep copy points so further widget mutations don't affect the snapshot
        state[k] = newCurves[k].map((p) => ({ x: p.x, y: p.y }));
      });
      draw();
    },
  } as unknown as CurvesUI;
}
/* v8 ignore stop */
