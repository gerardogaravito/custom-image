import './style.css';
import { apply } from './pipeline';
import { mountCurves } from './curves';
import { toast } from './toast';
import { isHeic, convertHeicToPng } from './heic';
import {
  type CropBox,
  type Handle,
  cropImageData,
  fitToAspect,
  fullBox,
  moveBox,
  parseAspect,
  resizeBox,
} from './crop';
import type { Adjust, State, Channel } from './types';
import { defaultAdjust, defaultCurves } from './types';

const MAX_PREVIEW = 1920;
const MAX_SOURCE = 4096;
// While the user is dragging a slider or curve point, render against this
// downscaled buffer instead of the full preview. ~16x fewer pixels = real-time
// feedback. On release, a final render happens against the full preview.
const MAX_INTERACTIVE = 480;
const INTERACTION_RELEASE_MS = 150;

const $ = <T extends Element>(q: string) => document.querySelector(q) as T;
const $$ = <T extends Element>(q: string) => Array.from(document.querySelectorAll(q)) as T[];

const view = $<HTMLCanvasElement>('#view');
const viewCtx = view.getContext('2d')!;
const viewport = $<HTMLDivElement>('#viewport');
const file = $<HTMLInputElement>('#file');
const drop = $<HTMLDivElement>('#drop');
const tools = $<HTMLElement>('#tools');
const zoomBar = $<HTMLDivElement>('#zoom');
const zoomLevel = $<HTMLElement>('#zoom-level');
const curveCanvas = $<HTMLCanvasElement>('#curve');
const reset = $<HTMLButtonElement>('#reset');

const cropOverlay = $<HTMLDivElement>('#crop-overlay');
const cropBoxEl = cropOverlay.querySelector<HTMLDivElement>('.crop-box')!;
const shadeTop = cropOverlay.querySelector<HTMLDivElement>('.crop-shade--top')!;
const shadeBottom = cropOverlay.querySelector<HTMLDivElement>('.crop-shade--bottom')!;
const shadeLeft = cropOverlay.querySelector<HTMLDivElement>('.crop-shade--left')!;
const shadeRight = cropOverlay.querySelector<HTMLDivElement>('.crop-shade--right')!;

let source: ImageData | null = null;   // current full-res (after any crops)
let preview: ImageData | null = null;  // current downscaled (after any crops)
let interactivePreview: ImageData | null = null;  // even smaller, used during drag
// Originals are kept untouched so the user can "restore" a crop.
let originalSource: ImageData | null = null;
let originalPreview: ImageData | null = null;
let sourceName = 'image';

let isInteracting = false;
let interactionEndTimer = 0;
function flagInteraction() {
  isInteracting = true;
  schedule();
  clearTimeout(interactionEndTimer);
  interactionEndTimer = window.setTimeout(() => {
    isInteracting = false;
    schedule();
  }, INTERACTION_RELEASE_MS);
}

const state: State = { adjust: defaultAdjust(), curves: defaultCurves() };

const curves = mountCurves(curveCanvas, () => { state.curves = curves.state; flagInteraction(); });

let rafId = 0;
function schedule() {
  if (!preview) return;
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    if (!preview) return;

    const useInteractive = isInteracting && interactivePreview !== null;
    const src = useInteractive ? interactivePreview! : preview;
    const out = apply(src, state);

    // Always anchor display dims to the full preview so the canvas size on
    // screen stays constant (no flicker between interactive ↔ full).
    view.width = preview.width;
    view.height = preview.height;

    if (out.width === preview.width && out.height === preview.height) {
      viewCtx.putImageData(out, 0, 0);
    } else {
      // Upscale the low-res interactive output via drawImage (GPU-fast).
      const tmp = makeCanvas(out.width, out.height);
      tmp.ctx.putImageData(out, 0, 0);
      viewCtx.imageSmoothingEnabled = true;
      viewCtx.imageSmoothingQuality = 'low';
      viewCtx.drawImage(
        (tmp.ctx as CanvasRenderingContext2D).canvas as CanvasImageSource,
        0, 0, preview.width, preview.height,
      );
    }
  });
}

function rebuildInteractivePreview() {
  if (!preview) { interactivePreview = null; return; }
  const longest = Math.max(preview.width, preview.height);
  if (longest <= MAX_INTERACTIVE) {
    interactivePreview = preview;
    return;
  }
  const scale = MAX_INTERACTIVE / longest;
  const w = Math.max(1, Math.round(preview.width * scale));
  const h = Math.max(1, Math.round(preview.height * scale));
  const full = makeCanvas(preview.width, preview.height);
  full.ctx.putImageData(preview, 0, 0);
  const small = makeCanvas(w, h);
  small.ctx.imageSmoothingQuality = 'high';
  small.ctx.drawImage(
    (full.ctx as CanvasRenderingContext2D).canvas as CanvasImageSource,
    0, 0, w, h,
  );
  interactivePreview = small.ctx.getImageData(0, 0, w, h);
}

function fitCanvas(w: number, h: number, max: number) {
  const s = Math.min(1, max / Math.max(w, h));
  return { w: Math.round(w * s), h: Math.round(h * s) };
}

// Returns a 2D context backed by OffscreenCanvas when available, otherwise a
// detached HTMLCanvasElement. Some Safari versions don't support OffscreenCanvas.
function makeCanvas(w: number, h: number): {
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  toBlob: (type: string, quality?: number) => Promise<Blob>;
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('No se pudo crear contexto 2D (OffscreenCanvas).');
    return {
      ctx,
      toBlob: (type, quality) => c.convertToBlob({ type, quality }),
    };
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear contexto 2D (canvas).');
  return {
    ctx,
    toBlob: (type, quality) =>
      new Promise<Blob>((resolve, reject) => {
        c.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Falló la conversión a blob.'))),
          type,
          quality,
        );
      }),
  };
}

function isImageFile(f: File): boolean {
  if (f.type && f.type.startsWith('image/')) return true;
  return /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(f.name);
}

async function bitmapFromFile(f: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(f);
    } catch {
      // fall through to HTMLImageElement
    }
  }
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('No se pudo decodificar la imagen.'));
      i.src = url;
    });
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

async function loadImage(f: File): Promise<void> {
  if (!isImageFile(f)) {
    toast(`Archivo no soportado: ${f.name}`, { kind: 'error' });
    return;
  }

  const bmp = await bitmapFromFile(f);
  const w = 'naturalWidth' in bmp ? bmp.naturalWidth : bmp.width;
  const h = 'naturalHeight' in bmp ? bmp.naturalHeight : bmp.height;
  if (!w || !h) throw new Error('La imagen tiene dimensiones inválidas.');

  const src = fitCanvas(w, h, MAX_SOURCE);
  const prev = fitCanvas(w, h, MAX_PREVIEW);

  const c1 = makeCanvas(src.w, src.h);
  c1.ctx.drawImage(bmp as CanvasImageSource, 0, 0, src.w, src.h);
  source = c1.ctx.getImageData(0, 0, src.w, src.h);

  const c2 = makeCanvas(prev.w, prev.h);
  c2.ctx.drawImage(bmp as CanvasImageSource, 0, 0, prev.w, prev.h);
  preview = c2.ctx.getImageData(0, 0, prev.w, prev.h);

  if ('close' in bmp && typeof bmp.close === 'function') bmp.close();

  originalSource = source;
  originalPreview = preview;
  cropBox = null;
  rebuildInteractivePreview();

  sourceName = f.name.replace(/\.[^.]+$/, '') || 'image';
  drop.hidden = true;
  tools.hidden = false;
  zoomBar.hidden = false;
  // Reset to fit-to-screen on every new image so the user always starts seeing
  // the whole photo regardless of the previous zoom state.
  setZoom('fit');
  schedule();
  // After the first frame paints (canvas intrinsic dims set), refresh the label
  // so it reflects the actual fit percentage.
  requestAnimationFrame(() => updateZoomLabel());
  toast(`${f.name} cargada (${w}×${h})`, { kind: 'success' });
}

// ----------------------------------------------------------------------------
// Zoom
// ----------------------------------------------------------------------------

const ZOOM_MIN = 0.1;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.25;            // botones / teclado
const ZOOM_WHEEL_SENSITIVITY = 0.0015; // factor = exp(-deltaY * sens)
const ZOOM_WHEEL_PER_EVENT_CAP = 1.15; // tope por evento, para que un solo tick no salte demasiado

type ZoomMode = 'fit' | number;
let zoomMode: ZoomMode = 'fit';

function naturalSize(): { w: number; h: number } | null {
  if (!preview) return null;
  return { w: preview.width, h: preview.height };
}

function effectiveZoom(): number {
  const ns = naturalSize();
  if (!ns) return 1;
  if (zoomMode === 'fit') {
    const sx = viewport.clientWidth / ns.w;
    const sy = viewport.clientHeight / ns.h;
    return Math.min(sx, sy, 1);
  }
  return zoomMode;
}

function updateZoomLabel() {
  zoomLevel.textContent = `${Math.round(effectiveZoom() * 100)}%`;
}

function setZoom(mode: ZoomMode, anchor?: { x: number; y: number }) {
  const ns = naturalSize();
  if (!ns) return;

  // For around-cursor zoom: remember the image coord under the anchor point
  // before changing zoom, then re-scroll so the same coord stays under it.
  let imgPoint: { x: number; y: number } | null = null;
  if (anchor && typeof zoomMode === 'number') {
    const r = view.getBoundingClientRect();
    imgPoint = {
      x: (anchor.x - r.left) / zoomMode,
      y: (anchor.y - r.top) / zoomMode,
    };
  }

  zoomMode = typeof mode === 'number' ? Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, mode)) : mode;

  if (zoomMode === 'fit') {
    view.dataset.zoomMode = 'fit';
    view.style.width = '';
    view.style.height = '';
  } else {
    view.dataset.zoomMode = 'manual';
    view.style.width = `${Math.round(ns.w * zoomMode)}px`;
    view.style.height = `${Math.round(ns.h * zoomMode)}px`;
  }

  updateZoomLabel();
  // Defer until after layout so scroll dimensions are accurate
  requestAnimationFrame(() => updatePannableState());

  if (imgPoint && typeof zoomMode === 'number' && anchor) {
    // After layout settles, scroll so that imgPoint sits under anchor
    requestAnimationFrame(() => {
      const targetX = imgPoint.x * (zoomMode as number);
      const targetY = imgPoint.y * (zoomMode as number);
      const r = view.getBoundingClientRect();
      const vr = viewport.getBoundingClientRect();
      const canvasOffsetX = r.left - vr.left + viewport.scrollLeft;
      const canvasOffsetY = r.top - vr.top + viewport.scrollTop;
      viewport.scrollLeft = canvasOffsetX + targetX - (anchor.x - vr.left);
      viewport.scrollTop = canvasOffsetY + targetY - (anchor.y - vr.top);
    });
  }
}

function zoomBy(factor: number, anchor?: { x: number; y: number }) {
  const current = effectiveZoom();
  setZoom(current * factor, anchor);
}

window.addEventListener('resize', () => {
  if (zoomMode === 'fit') updateZoomLabel();
  updatePannableState();
});

// ----------------------------------------------------------------------------
// Pan (hold + drag the canvas to scroll the viewport)
// ----------------------------------------------------------------------------

function updatePannableState() {
  const pannable =
    viewport.scrollWidth > viewport.clientWidth ||
    viewport.scrollHeight > viewport.clientHeight;
  view.classList.toggle('is-pannable', pannable && !cropActive);
}

type PanState = { startX: number; startY: number; scrollX: number; scrollY: number };
let pan: PanState | null = null;

view.addEventListener('pointerdown', (e) => {
  // Crop mode owns pointer events on the canvas via its overlay
  if (cropActive) return;
  if (e.button !== 0) return;
  const overflowsX = viewport.scrollWidth > viewport.clientWidth;
  const overflowsY = viewport.scrollHeight > viewport.clientHeight;
  if (!overflowsX && !overflowsY) return;
  pan = {
    startX: e.clientX,
    startY: e.clientY,
    scrollX: viewport.scrollLeft,
    scrollY: viewport.scrollTop,
  };
  view.classList.add('is-panning');
  view.setPointerCapture(e.pointerId);
  e.preventDefault();
});

window.addEventListener('pointermove', (e) => {
  if (!pan) return;
  viewport.scrollLeft = pan.scrollX - (e.clientX - pan.startX);
  viewport.scrollTop = pan.scrollY - (e.clientY - pan.startY);
});

window.addEventListener('pointerup', () => {
  if (!pan) return;
  pan = null;
  view.classList.remove('is-panning');
});

$<HTMLButtonElement>('#zoom-in').addEventListener('click', () => zoomBy(ZOOM_STEP));
$<HTMLButtonElement>('#zoom-out').addEventListener('click', () => zoomBy(1 / ZOOM_STEP));
$<HTMLButtonElement>('#zoom-fit').addEventListener('click', () => setZoom('fit'));
$<HTMLButtonElement>('#zoom-100').addEventListener('click', () => setZoom(1));

// Ctrl/Cmd + wheel to zoom around the cursor (matches browser convention).
// Trackpads emit many small events; a fixed step (e.g. *1.25 per tick) feels
// hyper-sensitive. Using `exp(-deltaY * k)` makes the zoom proportional to the
// gesture magnitude — works for both trackpads and mouse wheels.
viewport.addEventListener('wheel', (e) => {
  if (!preview) return;
  if (!(e.ctrlKey || e.metaKey)) return;
  e.preventDefault();
  let factor = Math.exp(-e.deltaY * ZOOM_WHEEL_SENSITIVITY);
  factor = Math.max(1 / ZOOM_WHEEL_PER_EVENT_CAP, Math.min(ZOOM_WHEEL_PER_EVENT_CAP, factor));
  zoomBy(factor, { x: e.clientX, y: e.clientY });
}, { passive: false });

async function handleFile(f: File | null | undefined): Promise<void> {
  if (!f) return;
  try {
    let input = f;
    if (isHeic(f)) {
      const dismiss = toast('Convirtiendo HEIC...', { durationMs: 0 });
      try {
        input = await convertHeicToPng(f);
      } finally {
        dismiss();
      }
    }
    await loadImage(input);
  } catch (err) {
    console.error('[loadImage]', err);
    const msg = err instanceof Error ? err.message : 'Error desconocido al cargar la imagen.';
    toast(msg, { kind: 'error' });
  }
}

file.addEventListener('change', () => {
  const f = file.files?.[0];
  // reset so the same file can be picked again
  file.value = '';
  void handleFile(f);
});

// Only fire programmatic file.click() when the user clicks the drop zone
// itself (not the inner <label>, which already opens the picker natively).
// Without this, the picker is opened twice and Chromium/Safari may cancel it.
drop.addEventListener('click', (ev) => {
  if (ev.target === drop) file.click();
});

['dragenter', 'dragover'].forEach((e) =>
  drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((e) =>
  drop.addEventListener(e, () => drop.classList.remove('is-over')));
drop.addEventListener('drop', (ev) => {
  ev.preventDefault();
  const f = ev.dataTransfer?.files[0];
  void handleFile(f);
});

// Prevent the browser from navigating away when files are dropped outside the zone
['dragover', 'drop'].forEach((e) =>
  window.addEventListener(e, (ev) => { ev.preventDefault(); }));

// ----------------------------------------------------------------------------
// Global keyboard shortcuts
// ----------------------------------------------------------------------------

function isTypingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable;
}

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    // Only meaningful once an image is loaded (otherwise tools is hidden anyway).
    if (!preview) return;
    tools.hidden = !tools.hidden;
    e.preventDefault();
    return;
  }

  // Don't hijack keys while the user is editing slider values or selects.
  if (isTypingInField(e.target)) return;
  if (!preview) return;

  switch (e.key) {
    case '+':
    case '=':
      zoomBy(ZOOM_STEP); e.preventDefault(); break;
    case '-':
    case '_':
      zoomBy(1 / ZOOM_STEP); e.preventDefault(); break;
    case '0':
      setZoom('fit'); e.preventDefault(); break;
    case '1':
      setZoom(1); e.preventDefault(); break;
  }
});

// Surface unhandled async errors so they aren't silent
window.addEventListener('unhandledrejection', (ev) => {
  const reason = ev.reason;
  const msg = reason instanceof Error ? reason.message : String(reason ?? 'Error inesperado');
  toast(msg, { kind: 'error' });
});
window.addEventListener('error', (ev) => {
  toast(ev.message || 'Error inesperado', { kind: 'error' });
});

// Tabs
$$('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const t = (btn as HTMLElement).dataset.tab!;
    $$('.tab').forEach((b) => b.classList.toggle('is-active', b === btn));
    $$('.panel').forEach((p) => { (p as HTMLElement).hidden = (p as HTMLElement).dataset.panel !== t; });
    if (t === 'crop') enterCropMode();
    else exitCropMode();
  });
});

// Channel tabs
$$('.chan__btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const c = (btn as HTMLElement).dataset.chan as Channel;
    $$('.chan__btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    curves.active = c;
  });
});

// Sliders
$$<HTMLInputElement>('input[data-adj]').forEach((inp) => {
  const key = inp.dataset.adj as keyof Adjust;
  const val = $<HTMLElement>(`[data-val="${key}"]`);
  inp.addEventListener('input', () => {
    state.adjust[key] = Number(inp.value);
    if (val) val.textContent = inp.value;
    flagInteraction();
  });
});

// Reset
reset.addEventListener('click', () => {
  state.adjust = defaultAdjust();
  curves.reset();
  state.curves = curves.state;
  $$<HTMLInputElement>('input[data-adj]').forEach((inp) => {
    const key = inp.dataset.adj as keyof Adjust;
    inp.value = String(state.adjust[key]);
    const val = $<HTMLElement>(`[data-val="${key}"]`);
    if (val) val.textContent = inp.value;
  });
  schedule();
});

// Export
const fmt = $<HTMLSelectElement>('#fmt');
const scale = $<HTMLSelectElement>('#scale');
const q = $<HTMLInputElement>('#q');
const qv = $<HTMLElement>('#qv');
const qwrap = $<HTMLElement>('#qwrap');
const download = $<HTMLButtonElement>('#download');

function syncQuality() { qwrap.hidden = fmt.value === 'png'; }
fmt.addEventListener('change', syncQuality);
q.addEventListener('input', () => { qv.textContent = q.value; });
syncQuality();

download.addEventListener('click', async () => {
  if (!source) {
    toast('No hay imagen cargada.', { kind: 'error' });
    return;
  }
  download.disabled = true;
  try {
    const processed = apply(source, state);
    const s = Number(scale.value);
    const outW = Math.max(1, Math.round(processed.width * s));
    const outH = Math.max(1, Math.round(processed.height * s));
    const out = makeCanvas(outW, outH);

    const tmp = makeCanvas(processed.width, processed.height);
    tmp.ctx.putImageData(processed, 0, 0);
    out.ctx.imageSmoothingQuality = 'high';
    out.ctx.drawImage(
      (tmp.ctx as CanvasRenderingContext2D).canvas as CanvasImageSource,
      0, 0, outW, outH,
    );

    const type = fmt.value === 'png' ? 'image/png' : 'image/jpeg';
    const quality = fmt.value === 'png' ? undefined : Number(q.value) / 100;
    const blob = await out.toBlob(type, quality);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sourceName}-edit.${fmt.value === 'png' ? 'png' : 'jpg'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Descarga lista.', { kind: 'success' });
  } catch (err) {
    console.error('[download]', err);
    const msg = err instanceof Error ? err.message : 'Error al exportar.';
    toast(msg, { kind: 'error' });
  } finally {
    download.disabled = false;
  }
});

// ----------------------------------------------------------------------------
// Crop
// ----------------------------------------------------------------------------

let cropBox: CropBox | null = null;        // in preview-pixel coords
let cropAspect: number | null = null;       // null = libre
let cropAspectKey = 'free';                 // 'free' | 'original' | 'W:H'
let cropOrient: 'portrait' | 'landscape' = 'portrait';
let cropActive = false;

function enterCropMode() {
  if (!preview) return;
  cropActive = true;
  if (!cropBox) cropBox = fullBox({ w: preview.width, h: preview.height });
  cropOverlay.hidden = false;
  cropOverlay.classList.add('is-active');
  updatePannableState();
  syncOverlay();
}

function exitCropMode() {
  cropActive = false;
  cropOverlay.hidden = true;
  cropOverlay.classList.remove('is-active');
  updatePannableState();
}

/** Compute a handle's image-pixel position from a box (used to seed drag). */
function handleImagePos(handle: Handle, box: CropBox): { x: number; y: number } {
  const { x, y, w, h } = box;
  switch (handle) {
    case 'nw': return { x, y };
    case 'ne': return { x: x + w, y };
    case 'sw': return { x, y: y + h };
    case 'se': return { x: x + w, y: y + h };
    case 'n':  return { x: x + w / 2, y };
    case 's':  return { x: x + w / 2, y: y + h };
    case 'w':  return { x, y: y + h / 2 };
    case 'e':  return { x: x + w, y: y + h / 2 };
    case 'move': return { x, y };
  }
}

function syncOverlay() {
  if (!preview || !cropBox || !cropActive) return;
  const r = view.getBoundingClientRect();
  const vr = viewport.getBoundingClientRect();
  const scale = r.width / preview.width;

  // Position the overlay container exactly over the canvas (account for scroll)
  cropOverlay.style.left = `${r.left - vr.left + viewport.scrollLeft}px`;
  cropOverlay.style.top = `${r.top - vr.top + viewport.scrollTop}px`;
  cropOverlay.style.width = `${r.width}px`;
  cropOverlay.style.height = `${r.height}px`;

  const bx = cropBox.x * scale;
  const by = cropBox.y * scale;
  const bw = cropBox.w * scale;
  const bh = cropBox.h * scale;

  cropBoxEl.style.left = `${bx}px`;
  cropBoxEl.style.top = `${by}px`;
  cropBoxEl.style.width = `${bw}px`;
  cropBoxEl.style.height = `${bh}px`;

  // Shades around the box
  shadeTop.style.height = `${by}px`;
  shadeBottom.style.top = `${by + bh}px`;
  shadeBottom.style.height = `${r.height - (by + bh)}px`;
  shadeLeft.style.top = `${by}px`;
  shadeLeft.style.height = `${bh}px`;
  shadeLeft.style.width = `${bx}px`;
  shadeRight.style.top = `${by}px`;
  shadeRight.style.height = `${bh}px`;
  shadeRight.style.left = `${bx + bw}px`;
  shadeRight.style.width = `${r.width - (bx + bw)}px`;
}

// Re-sync overlay on any layout-changing event
const ro = new ResizeObserver(() => syncOverlay());
ro.observe(view);
viewport.addEventListener('scroll', syncOverlay);
window.addEventListener('resize', syncOverlay);

// Drag (resize/move) for the crop box
type Drag = {
  handle: Handle;
  startBox: CropBox;
  startCursor: { x: number; y: number };
  scale: number; // display px per image px
};
let drag: Drag | null = null;

cropBoxEl.addEventListener('pointerdown', (e) => {
  if (!preview || !cropBox) return;
  const target = e.target as HTMLElement;
  const handleEl = target.closest<HTMLElement>('.crop-handle');
  const handle: Handle = handleEl
    ? (handleEl.dataset.handle as Handle)
    : 'move';
  const r = view.getBoundingClientRect();
  drag = {
    handle,
    startBox: { ...cropBox },
    startCursor: { x: e.clientX, y: e.clientY },
    scale: r.width / preview.width,
  };
  cropBoxEl.setPointerCapture(e.pointerId);
  e.preventDefault();
  e.stopPropagation();
});

window.addEventListener('pointermove', (e) => {
  if (!drag || !cropBox || !preview) return;
  const dx = (e.clientX - drag.startCursor.x) / drag.scale;
  const dy = (e.clientY - drag.startCursor.y) / drag.scale;
  const bounds = { w: preview.width, h: preview.height };

  if (drag.handle === 'move') {
    cropBox = moveBox(drag.startBox, dx, dy, bounds);
  } else {
    const start = handleImagePos(drag.handle, drag.startBox);
    const cursorImg = { x: start.x + dx, y: start.y + dy };
    cropBox = resizeBox(drag.handle, cursorImg, drag.startBox, bounds, cropAspect);
  }
  syncOverlay();
});

window.addEventListener('pointerup', () => { drag = null; });

// Aspect ratio selector
function setAspect(key: string) {
  cropAspectKey = key;
  if (key === 'free') {
    cropAspect = null;
  } else if (key === 'original' && preview) {
    cropAspect = preview.width / preview.height;
  } else {
    let a = parseAspect(key);
    if (a === null) return;
    // The buttons store the portrait ratio (W:H with W < H). Flip on landscape.
    if (cropOrient === 'landscape' && a < 1) a = 1 / a;
    if (cropOrient === 'portrait' && a > 1) a = 1 / a;
    cropAspect = a;
  }
  $$('.aspect-btn').forEach((b) => {
    b.classList.toggle('is-active', (b as HTMLElement).dataset.aspect === key);
  });
  if (cropBox && preview && cropAspect !== null) {
    cropBox = fitToAspect(cropBox, cropAspect, { w: preview.width, h: preview.height });
    syncOverlay();
  }
}

$$('.aspect-btn').forEach((btn) => {
  btn.addEventListener('click', () => setAspect((btn as HTMLElement).dataset.aspect!));
});

$$('.crop-orient__btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const o = (btn as HTMLElement).dataset.orient as 'portrait' | 'landscape';
    cropOrient = o;
    $$('.crop-orient__btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    setAspect(cropAspectKey);
  });
});

// Apply / restore
$<HTMLButtonElement>('#crop-apply').addEventListener('click', () => {
  if (!preview || !source || !cropBox) return;
  // Project the crop box from preview-pixels to source-pixels.
  const sx = source.width / preview.width;
  const sy = source.height / preview.height;
  const sourceBoxPx: CropBox = {
    x: cropBox.x * sx,
    y: cropBox.y * sy,
    w: cropBox.w * sx,
    h: cropBox.h * sy,
  };
  preview = cropImageData(preview, cropBox);
  source = cropImageData(source, sourceBoxPx);
  cropBox = null;
  rebuildInteractivePreview();
  exitCropMode();
  setZoom('fit');
  schedule();
  requestAnimationFrame(() => updateZoomLabel());
  toast('Recorte aplicado.', { kind: 'success' });
});

$<HTMLButtonElement>('#crop-reset').addEventListener('click', () => {
  if (!originalSource || !originalPreview) return;
  source = originalSource;
  preview = originalPreview;
  rebuildInteractivePreview();
  cropBox = preview ? fullBox({ w: preview.width, h: preview.height }) : null;
  setZoom('fit');
  schedule();
  requestAnimationFrame(() => {
    updateZoomLabel();
    if (cropActive) syncOverlay();
  });
  toast('Imagen restaurada al original.', { kind: 'success' });
});
