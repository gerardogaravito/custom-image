// Pure logic for the crop overlay.
// All coordinates are in image pixels (the preview's natural dimensions).

export type CropBox = { x: number; y: number; w: number; h: number };

export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'move';

export type Bounds = { w: number; h: number };

const MIN_SIZE = 20;

const H_EDGE_HANDLES: ReadonlySet<Handle> = new Set(['n', 's']);
const V_EDGE_HANDLES: ReadonlySet<Handle> = new Set(['e', 'w']);

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Returns the point of the original box that should NOT move while dragging `handle`. */
export function anchorOf(handle: Handle, box: CropBox): { x: number; y: number } {
  const { x, y, w, h } = box;
  switch (handle) {
    case 'nw': return { x: x + w, y: y + h };
    case 'ne': return { x,         y: y + h };
    case 'sw': return { x: x + w, y };
    case 'se': return { x,         y };
    case 'n':  return { x: x + w / 2, y: y + h };
    case 's':  return { x: x + w / 2, y };
    case 'w':  return { x: x + w,     y: y + h / 2 };
    case 'e':  return { x,             y: y + h / 2 };
    case 'move': return { x, y };
  }
}

/**
 * Compute a new crop box while a resize handle is dragged.
 * `cursor` is the current cursor position in image-pixel coords.
 *
 * Strategy: rather than building a box and clamping post-hoc (which silently
 * breaks aspect ratios at bounds), we constrain the *available* box space from
 * the anchor outward and grow within those limits, keeping aspect intact.
 */
export function resizeBox(
  handle: Handle,
  cursor: { x: number; y: number },
  original: CropBox,
  bounds: Bounds,
  aspect: number | null,
): CropBox {
  if (handle === 'move') return original;

  const anchor = anchorOf(handle, original);

  if (H_EDGE_HANDLES.has(handle)) {
    return resizeFromHorizontalEdge(handle, anchor, cursor, original, bounds, aspect);
  }
  if (V_EDGE_HANDLES.has(handle)) {
    return resizeFromVerticalEdge(handle, anchor, cursor, original, bounds, aspect);
  }
  return resizeFromCorner(handle, anchor, cursor, bounds, aspect);
}

function resizeFromCorner(
  _handle: Handle,
  anchor: { x: number; y: number },
  cursor: { x: number; y: number },
  bounds: Bounds,
  aspect: number | null,
): CropBox {
  const goingRight = cursor.x >= anchor.x;
  const goingDown = cursor.y >= anchor.y;
  const maxW = goingRight ? bounds.w - anchor.x : anchor.x;
  const maxH = goingDown ? bounds.h - anchor.y : anchor.y;

  let dx = Math.min(Math.abs(cursor.x - anchor.x), maxW);
  let dy = Math.min(Math.abs(cursor.y - anchor.y), maxH);
  dx = Math.max(dx, MIN_SIZE);
  dy = Math.max(dy, MIN_SIZE);

  if (aspect !== null && aspect > 0) {
    // Pick the larger derived dimension that still fits inside the available
    // room from the anchor — preserves aspect even at bounds.
    const dxFromDy = dy * aspect;
    if (dxFromDy >= dx) {
      // Height-driven
      if (dxFromDy <= maxW) {
        dx = dxFromDy;
      } else {
        dx = maxW;
        dy = dx / aspect;
      }
    } else {
      // Width-driven
      const dyFromDx = dx / aspect;
      if (dyFromDx <= maxH) {
        dy = dyFromDx;
      } else {
        dy = maxH;
        dx = dy * aspect;
      }
    }
  }

  return {
    x: goingRight ? anchor.x : anchor.x - dx,
    y: goingDown ? anchor.y : anchor.y - dy,
    w: dx,
    h: dy,
  };
}

function resizeFromHorizontalEdge(
  _handle: Handle,
  anchor: { x: number; y: number },
  cursor: { x: number; y: number },
  original: CropBox,
  bounds: Bounds,
  aspect: number | null,
): CropBox {
  const goingDown = cursor.y >= anchor.y;
  const maxH = goingDown ? bounds.h - anchor.y : anchor.y;
  let h = Math.min(Math.abs(cursor.y - anchor.y), maxH);
  h = Math.max(h, MIN_SIZE);

  let w = original.w;
  let x = original.x;

  if (aspect !== null && aspect > 0) {
    // Width derives from h, centered on original cx. Bound by available width.
    const cx = original.x + original.w / 2;
    const maxWCentered = Math.min(cx, bounds.w - cx) * 2;
    w = h * aspect;
    if (w > maxWCentered) {
      w = maxWCentered;
      h = w / aspect;
    }
    x = cx - w / 2;
  }

  return {
    x,
    y: goingDown ? anchor.y : anchor.y - h,
    w,
    h,
  };
}

function resizeFromVerticalEdge(
  _handle: Handle,
  anchor: { x: number; y: number },
  cursor: { x: number; y: number },
  original: CropBox,
  bounds: Bounds,
  aspect: number | null,
): CropBox {
  const goingRight = cursor.x >= anchor.x;
  const maxW = goingRight ? bounds.w - anchor.x : anchor.x;
  let w = Math.min(Math.abs(cursor.x - anchor.x), maxW);
  w = Math.max(w, MIN_SIZE);

  let h = original.h;
  let y = original.y;

  if (aspect !== null && aspect > 0) {
    const cy = original.y + original.h / 2;
    const maxHCentered = Math.min(cy, bounds.h - cy) * 2;
    h = w / aspect;
    if (h > maxHCentered) {
      h = maxHCentered;
      w = h * aspect;
    }
    y = cy - h / 2;
  }

  return {
    x: goingRight ? anchor.x : anchor.x - w,
    y,
    w,
    h,
  };
}

/** Move (pan) a crop box by (dx, dy) within bounds. Size is preserved. */
export function moveBox(original: CropBox, dx: number, dy: number, bounds: Bounds): CropBox {
  return {
    x: clamp(original.x + dx, 0, bounds.w - original.w),
    y: clamp(original.y + dy, 0, bounds.h - original.h),
    w: original.w,
    h: original.h,
  };
}

/**
 * Resize the box to match a new aspect ratio while:
 *  - keeping the original center when possible,
 *  - fitting inside `bounds`,
 *  - never going below MIN_SIZE on either dimension.
 *
 * `aspect = null` returns the original box (free mode).
 */
export function fitToAspect(box: CropBox, aspect: number | null, bounds: Bounds): CropBox {
  if (aspect === null || aspect <= 0) return clampToBounds(box, bounds);

  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  // Try keeping width, derive height
  let w = box.w;
  let h = w / aspect;
  // If derived height doesn't fit, scale down by height instead
  if (h > box.h) {
    h = box.h;
    w = h * aspect;
  }
  // Final shrink to ensure it fits in bounds
  if (w > bounds.w) { w = bounds.w; h = w / aspect; }
  if (h > bounds.h) { h = bounds.h; w = h * aspect; }
  if (w < MIN_SIZE) { w = MIN_SIZE; h = w / aspect; }
  if (h < MIN_SIZE) { h = MIN_SIZE; w = h * aspect; }

  let x = cx - w / 2;
  let y = cy - h / 2;
  x = clamp(x, 0, bounds.w - w);
  y = clamp(y, 0, bounds.h - h);

  return { x, y, w, h };
}

/** Initial full-image crop box. */
export function fullBox(bounds: Bounds): CropBox {
  return { x: 0, y: 0, w: bounds.w, h: bounds.h };
}

function clampToBounds(box: CropBox, bounds: Bounds): CropBox {
  const w = clamp(box.w, MIN_SIZE, bounds.w);
  const h = clamp(box.h, MIN_SIZE, bounds.h);
  const x = clamp(box.x, 0, bounds.w - w);
  const y = clamp(box.y, 0, bounds.h - h);
  return { x, y, w, h };
}

/**
 * Slice an `ImageData` to the rectangle `box`. Coordinates are rounded to
 * integer pixels. Pure: no canvas, no DOM.
 */
export function cropImageData(src: ImageData, box: CropBox): ImageData {
  const x = Math.max(0, Math.round(box.x));
  const y = Math.max(0, Math.round(box.y));
  const w = Math.max(1, Math.min(src.width - x, Math.round(box.w)));
  const h = Math.max(1, Math.min(src.height - y, Math.round(box.h)));

  const out = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    const srcOffset = ((y + row) * src.width + x) * 4;
    const dstOffset = row * w * 4;
    out.set(src.data.subarray(srcOffset, srcOffset + w * 4), dstOffset);
  }
  return new ImageData(out, w, h);
}

/** Convert a "W:H" string (e.g., "4:5") to a numeric aspect ratio (W/H). */
export function parseAspect(s: string): number | null {
  const m = /^(\d+):(\d+)$/.exec(s);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!w || !h) return null;
  return w / h;
}

/**
 * Compose a previously-applied crop with a new one to produce a single crop in
 * the ORIGINAL source's coordinate system. Used for session persistence — we
 * save the cumulative crop in original coords so we can re-derive the current
 * source from the original blob on reload, regardless of how many sub-crops the
 * user applied.
 *
 *  - `previous`: existing applied crop (in original-source pixel coords), or null
 *  - `next`:     newly-applied crop (in CURRENT-source pixel coords, which is
 *                itself the slice defined by `previous`)
 *
 * Returns the new cumulative crop in original-source pixel coords.
 */
export function composeAppliedCrop(previous: CropBox | null, next: CropBox): CropBox {
  if (!previous) return { x: next.x, y: next.y, w: next.w, h: next.h };
  return {
    x: previous.x + next.x,
    y: previous.y + next.y,
    w: next.w,
    h: next.h,
  };
}
