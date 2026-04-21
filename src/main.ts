import './style.css';
import { inject as injectAnalytics } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';
import { apply } from './pipeline';
import { mountCurves } from './curves';
import { toast } from './toast';
import { isHeic, convertHeicToPng } from './heic';

// Vercel: visit tracking + Core Web Vitals. Both auto-detect environment and
// only send beacons in production deployments — no-op in dev.
injectAnalytics();
injectSpeedInsights();
import {
  type CropBox,
  type Handle,
  composeAppliedCrop,
  cropImageData,
  fitToAspect,
  fullBox,
  moveBox,
  parseAspect,
  resizeBox,
} from './crop';
import { History } from './undo';
import { type Session, clearSession, loadSession, saveSession } from './persist';
import { HINTS } from './config';
import type { Adjust, Curves, State, Channel } from './types';
import { defaultAdjust } from './types';

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
const toolsToggle = $<HTMLButtonElement>('#tools-toggle');
const curveCanvas = $<HTMLCanvasElement>('#curve');
const reset = $<HTMLButtonElement>('#reset');

const abHint = $<HTMLElement>('#ab-hint');
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

// Persistence state. `originalBlob` is the user's uploaded file (post-HEIC),
// stored in IndexedDB so we can re-decode it on reload. `appliedCrop` tracks
// the cumulative crop in ORIGINAL source-pixel coords, so re-applying it on
// reload produces the exact same current source/preview.
let originalBlob: Blob | null = null;
let appliedCrop: CropBox | null = null;

let isInteracting = false;
let interactionEndTimer = 0;
function flagInteraction() {
  // Snapshot once at the START of each interaction burst (slider drag, curve
  // edit, dblclick reset). Within a burst (continuous input), no extra
  // snapshots — otherwise a single drag would push hundreds.
  if (!isInteracting) pushUndo();
  isInteracting = true;
  schedule();
  clearTimeout(interactionEndTimer);
  interactionEndTimer = window.setTimeout(() => {
    isInteracting = false;
    schedule();
    scheduleSave();  // burst ended → persist
  }, INTERACTION_RELEASE_MS);
}

// `state.curves` and the curve widget's internal state MUST be the same
// reference from the start. Otherwise `state.curves` points to a stale
// `defaultCurves()` instance until the user's first curve edit triggers the
// callback that re-aligns them — which means saves/snapshots/persistence
// could capture the wrong object. Alias from init eliminates the race.
const curves = mountCurves(curveCanvas, () => flagInteraction());
const state: State = { adjust: defaultAdjust(), curves: curves.state };

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
  appliedCrop = null;
  rebuildInteractivePreview();

  sourceName = f.name.replace(/\.[^.]+$/, '') || 'image';
  drop.hidden = true;
  setToolsHidden(false);
  maybeShowEscHint();
  zoomBar.hidden = false;
  // Reset history on a fresh image so we don't restore stale buffers
  history.clear();
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
    // Capture the post-HEIC blob so the persisted session re-decodes the same
    // pixels (avoids re-doing the heic2any WASM round-trip on reload).
    originalBlob = input;
    await loadImage(input);
    scheduleSave();
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

// "cambiar imagen" — opens the same file picker as the drop zone, so the user
// can swap the loaded image without refreshing.
$<HTMLButtonElement>('#change-image').addEventListener('click', (e) => {
  file.click();
  // Take focus off the button so the parent .reset-group's `:focus-within`
  // releases and the dropdown collapses. Without this, cancelling the file
  // picker leaves the menu open until the user clicks somewhere else.
  (e.currentTarget as HTMLButtonElement).blur();
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
    if (!preview) return;
    setToolsHidden(!tools.hidden);
    e.preventDefault();
    return;
  }

  // Cmd/Ctrl + Z → undo, Cmd/Ctrl + Shift + Z → redo. Allowed even from inputs
  // because sliders don't have their own undo, and text inputs are rare here.
  if ((e.metaKey || e.ctrlKey) && (e.key === 'z' || e.key === 'Z')) {
    if (!preview) return;
    e.preventDefault();
    if (e.shiftKey) redo();
    else undo();
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

// ----------------------------------------------------------------------------
// A/B hint (floating discoverability nudge for the dblclick-to-toggle gesture)
// ----------------------------------------------------------------------------
// Driven by HINTS.ab in src/config.ts: empty string = the hint never shows.
// Set HINTS.ab to a non-empty text → it appears once per session whenever the
// tools panel becomes visible, regardless of active tab. Auto-dismiss at 10s
// or on click.

let abHintShown = false; // once-per-session — no nag
let abHintTimer = 0;

function showAbHint() {
  if (abHintShown) return;
  if (!HINTS.ab) return; // disabled by config — skip render entirely
  abHintShown = true;
  abHint.textContent = HINTS.ab;
  // Position right below the tools panel (its height varies per active tab)
  const r = tools.getBoundingClientRect();
  abHint.style.top = `${r.bottom + 8}px`;
  abHint.hidden = false;
  requestAnimationFrame(() => abHint.classList.add('is-in'));
  abHintTimer = window.setTimeout(dismissAbHint, HINTS.abDurationSeconds * 1000);
}

function dismissAbHint() {
  clearTimeout(abHintTimer);
  if (abHint.hidden) return;
  abHint.classList.remove('is-in');
  setTimeout(() => { abHint.hidden = true; }, 200);
}

abHint.addEventListener('click', dismissAbHint);

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
function setSliderValue(key: keyof Adjust, value: number) {
  state.adjust[key] = value;
  const inp = $<HTMLInputElement>(`input[data-adj="${key}"]`);
  if (inp) inp.value = String(value);
  const val = $<HTMLElement>(`[data-val="${key}"]`);
  if (val) val.textContent = String(value);
}

function syncSliderInputs() {
  $$<HTMLInputElement>('input[data-adj]').forEach((inp) => {
    const key = inp.dataset.adj as keyof Adjust;
    inp.value = String(state.adjust[key]);
    const val = $<HTMLElement>(`[data-val="${key}"]`);
    if (val) val.textContent = inp.value;
  });
}

// For each slider, remember the value at the START of the most recent
// interaction burst. The double-click handler swaps current ↔ this value, so
// the user can "blink" between the last two positions to compare A/B.
// Initialized to the defaults so a dblclick BEFORE any edit acts as a reset.
const previousValue = new Map<keyof Adjust, number>();
{
  const def = defaultAdjust();
  for (const k of Object.keys(def) as Array<keyof Adjust>) previousValue.set(k, def[k]);
}

$$<HTMLInputElement>('input[data-adj]').forEach((inp) => {
  const key = inp.dataset.adj as keyof Adjust;
  const val = $<HTMLElement>(`[data-val="${key}"]`);
  inp.addEventListener('input', () => {
    // First input event of a fresh burst — record the pre-burst value
    if (!isInteracting) previousValue.set(key, state.adjust[key]);
    state.adjust[key] = Number(inp.value);
    if (val) val.textContent = inp.value;
    flagInteraction();
  });
});

// A/B toggle: swap current ↔ previous value of one slider, so the user can
// flip between two positions to compare. First double-click after an edit
// goes back to the pre-edit value; second goes forward; and so on.
function toggleSliderValue(key: keyof Adjust) {
  const previous = previousValue.get(key) ?? defaultAdjust()[key];
  const current = state.adjust[key];
  if (previous === current) return;
  pushUndo();
  setSliderValue(key, previous);
  previousValue.set(key, current); // next toggle swaps back
  schedule();
  scheduleSave();
}

// Two paths to the same A/B toggle, picked by gesture cost:
//  - Single CLICK on the label (`<span>`) — cheap, lighter intent. The label
//    is "passive" UI text, so a click feels natural and there's nothing else
//    to accidentally trigger.
//  - Double CLICK on the value indicator (`<i>`) or the slider itself
//    (`<input type="range">`) — more deliberate, prevents accidental toggles
//    on the active controls users hover/drag often.
//
// Edge case for slider: dblclicking the TRACK fires an input event first (the
// click moves the slider). The toggle then swaps to the previous value, so
// effectively the click gets "reverted" — consistent with toggle semantics.
// Dblclicking the THUMB doesn't move the value, swap is clean.
//
// Event delegation on the adjust panel — robust if more sliders are added.
function dispatchToggle(e: Event) {
  const target = e.target as HTMLElement;
  const sl = target.closest('.sl');
  const valEl = sl?.querySelector<HTMLElement>('[data-val]');
  if (!valEl) return;
  toggleSliderValue(valEl.dataset.val as keyof Adjust);
}

$<HTMLElement>('.panel[data-panel="adjust"]').addEventListener('click', (e) => {
  const target = e.target as HTMLElement;
  if (!target.matches('.sl span')) return;
  // The wrapping <label> would otherwise focus the slider input as a side
  // effect (default label behavior). preventDefault keeps focus where it was.
  e.preventDefault();
  dispatchToggle(e);
});

$<HTMLElement>('.panel[data-panel="adjust"]').addEventListener('dblclick', (e) => {
  const target = e.target as HTMLElement;
  if (!target.matches('.sl i[data-val], .sl input[data-adj]')) return;
  dispatchToggle(e);
});

// Reset (uses the undo system below)
reset.addEventListener('click', () => {
  pushUndo();
  state.adjust = defaultAdjust();
  curves.reset();
  syncSliderInputs();
  schedule();
  scheduleSave();
  toast('ajustes restaurados', {
    kind: 'info',
    action: { label: 'undo', onClick: undo },
  });
});

// Export
const fmt = $<HTMLSelectElement>('#fmt');
const scale = $<HTMLSelectElement>('#scale');
const q = $<HTMLInputElement>('#q');
const qv = $<HTMLElement>('#qv');
const qwrap = $<HTMLElement>('#qwrap');
const download = $<HTMLButtonElement>('#download');

// Session-wide counter per source name. Browsers can't inspect the user's
// filesystem (sandbox), so we can't know if `Photo_01.png` already exists on
// disk — but we can give each download a unique 2-digit suffix within the
// current session. First download = _01, second = _02, ... up to _99.
const downloadCounters = new Map<string, number>();
function nextDownloadName(base: string, ext: string): string {
  const next = (downloadCounters.get(base) ?? 0) + 1;
  downloadCounters.set(base, next);
  return `${base}_${String(next).padStart(2, '0')}.${ext}`;
}

// On touch devices, prefer Web Share API so the image hits the iOS/Android
// share sheet — where "Guardar imagen" puts it in the Photos camera roll.
// `<a download>` alone only saves to Downloads/Files, not Photos.
async function saveImage(blob: Blob, filename: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const isTouch = matchMedia('(hover: none)').matches;
  if (isTouch && typeof navigator !== 'undefined' && 'canShare' in navigator) {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return 'shared';
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
        // Any other error → fall through to the download path
      }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return 'downloaded';
}

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
    const filename = nextDownloadName(sourceName, fmt.value === 'png' ? 'png' : 'jpg');
    const result = await saveImage(blob, filename);
    if (result === 'shared') toast('imagen guardada', { kind: 'success' });
    else if (result === 'downloaded') toast('descarga lista', { kind: 'success' });
    // 'cancelled' (user closed the share sheet) → no toast
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
function recomputeCropAspect() {
  if (cropAspectKey === 'free') {
    cropAspect = null;
    return;
  }
  if (cropAspectKey === 'original' && preview) {
    cropAspect = preview.width / preview.height;
    return;
  }
  let a = parseAspect(cropAspectKey);
  if (a === null) { cropAspect = null; return; }
  // The buttons store the portrait ratio (W:H with W < H). Flip on landscape.
  if (cropOrient === 'landscape' && a < 1) a = 1 / a;
  if (cropOrient === 'portrait' && a > 1) a = 1 / a;
  cropAspect = a;
}

function syncCropAspectButtons() {
  $$('.aspect-btn').forEach((b) => {
    b.classList.toggle('is-active', (b as HTMLElement).dataset.aspect === cropAspectKey);
  });
}

function syncCropOrientButtons() {
  $$('.crop-orient__btn').forEach((b) => {
    b.classList.toggle('is-active', (b as HTMLElement).dataset.orient === cropOrient);
  });
}

function setAspect(key: string) {
  cropAspectKey = key;
  recomputeCropAspect();
  syncCropAspectButtons();
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
    cropOrient = (btn as HTMLElement).dataset.orient as 'portrait' | 'landscape';
    syncCropOrientButtons();
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
  // Compose the cumulative crop in original-source coords for persistence.
  appliedCrop = composeAppliedCrop(appliedCrop, sourceBoxPx);
  // Stay in crop mode and reset the box to the new full bounds. The pre-apply
  // snapshot (pushed by the capture-phase listener below) keeps the previous
  // box, so undo restores both source/preview AND the user's last selection.
  cropBox = fullBox({ w: preview.width, h: preview.height });
  rebuildInteractivePreview();
  if (cropActive) syncOverlay();
  setZoom('fit');
  schedule();
  requestAnimationFrame(() => updateZoomLabel());
  scheduleSave();
  toast('recorte aplicado', {
    kind: 'success',
    action: { label: 'undo', onClick: undo },
  });
});

$<HTMLButtonElement>('#crop-reset').addEventListener('click', () => {
  if (!originalSource || !originalPreview) return;
  pushUndo();
  source = originalSource;
  preview = originalPreview;
  appliedCrop = null;
  rebuildInteractivePreview();
  cropBox = preview ? fullBox({ w: preview.width, h: preview.height }) : null;
  setZoom('fit');
  schedule();
  requestAnimationFrame(() => {
    updateZoomLabel();
    if (cropActive) syncOverlay();
  });
  scheduleSave();
  toast('imagen restaurada al original', {
    kind: 'success',
    action: { label: 'undo', onClick: undo },
  });
});

// ----------------------------------------------------------------------------
// Undo / redo
// ----------------------------------------------------------------------------

type Snapshot = {
  adjust: Adjust;
  curves: Curves;
  source: ImageData;
  preview: ImageData;
  interactivePreview: ImageData | null;
  // Crop state must be in the snapshot too — otherwise undoing an "aplicar"
  // restored source/preview but lost the user's selection box.
  cropBox: CropBox | null;
  cropAspectKey: string;
  cropOrient: 'portrait' | 'landscape';
  // Cumulative crop in original-source coords. Has to round-trip too so
  // persistence stays consistent after undo/redo.
  appliedCrop: CropBox | null;
};

const history = new History<Snapshot>(20);

function deepCopyCurves(c: Curves): Curves {
  return {
    m: c.m.map((p) => ({ x: p.x, y: p.y })),
    r: c.r.map((p) => ({ x: p.x, y: p.y })),
    g: c.g.map((p) => ({ x: p.x, y: p.y })),
    b: c.b.map((p) => ({ x: p.x, y: p.y })),
  };
}

function makeSnapshot(): Snapshot {
  return {
    adjust: { ...state.adjust },
    curves: deepCopyCurves(state.curves),
    source: source!,
    preview: preview!,
    interactivePreview,
    cropBox: cropBox ? { ...cropBox } : null,
    cropAspectKey,
    cropOrient,
    appliedCrop: appliedCrop ? { ...appliedCrop } : null,
  };
}

function applySnapshot(snap: Snapshot) {
  state.adjust = { ...snap.adjust };
  curves.setState(snap.curves);
  // No need to reassign state.curves — it shares the widget's state reference
  source = snap.source;
  preview = snap.preview;
  interactivePreview = snap.interactivePreview;
  cropBox = snap.cropBox ? { ...snap.cropBox } : null;
  cropAspectKey = snap.cropAspectKey;
  cropOrient = snap.cropOrient;
  appliedCrop = snap.appliedCrop ? { ...snap.appliedCrop } : null;
  recomputeCropAspect();
  syncCropAspectButtons();
  syncCropOrientButtons();
  syncSliderInputs();
  schedule();
  // If the user is currently on the crop tab, redraw the overlay with the
  // restored box. (cropActive itself is not snapshotted — we don't force-switch
  // tabs on undo.)
  if (cropActive && preview) syncOverlay();
  scheduleSave();
}

function pushUndo() {
  if (!source || !preview) return;
  history.push(makeSnapshot());
}

function undo() {
  if (!history.canUndo()) {
    toast('nada que deshacer', { kind: 'info', durationMs: 1500 });
    return;
  }
  const snap = history.undo(makeSnapshot())!;
  applySnapshot(snap);
}

function redo() {
  if (!history.canRedo()) {
    toast('nada que rehacer', { kind: 'info', durationMs: 1500 });
    return;
  }
  const snap = history.redo(makeSnapshot())!;
  applySnapshot(snap);
}

// Push a snapshot before applying a crop — so an accidental "aplicar" can be
// undone the same way. Uses the capture phase to run BEFORE the existing
// inline listener that mutates source/preview.
$<HTMLButtonElement>('#crop-apply').addEventListener('click', () => {
  if (preview && cropBox) pushUndo();
}, { capture: true });

// ----------------------------------------------------------------------------
// Tools toggle (mobile + desktop)
// ----------------------------------------------------------------------------

function syncToolsToggleLabel() {
  toolsToggle.textContent = tools.hidden ? 'menu' : 'ocultar';
}

// First-time discoverability hint for the ESC shortcut. Only on desktop
// (touch devices have the "menu" button right there in the zoom bar) and only
// once per session — we don't want to nag.
let escHintShown = false;
function maybeShowEscHint() {
  if (escHintShown) return;
  if (!matchMedia('(hover: hover)').matches) return;
  escHintShown = true;
  toast('ESC para ocultar el menú', { kind: 'info', durationMs: 5000 });
}

function setToolsHidden(hidden: boolean) {
  tools.hidden = hidden;
  // The crop overlay floats on top of the canvas — without the panel that
  // controls it, it has no business being there. Hide it with the panel and
  // restore it when the panel comes back (only if the user was in crop mode).
  if (cropActive) {
    cropOverlay.hidden = hidden;
    if (!hidden) syncOverlay();
  }
  // The A/B hint anchors to tools.bottom — pointless when tools is hidden.
  if (hidden) dismissAbHint();
  else showAbHint();
  syncToolsToggleLabel();
}

toolsToggle.addEventListener('click', () => setToolsHidden(!tools.hidden));

// ----------------------------------------------------------------------------
// Session persistence (IndexedDB)
// ----------------------------------------------------------------------------

const SAVE_DEBOUNCE_MS = 400;
let saveTimer = 0;

/**
 * Persist the current session. Debounced so a slider drag (which fires many
 * state updates) only writes once after the burst settles.
 */
function scheduleSave() {
  if (!originalBlob || !source || !preview) return;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    void saveSession({
      schemaVersion: 1,
      sourceName,
      blob: originalBlob!,
      appliedCrop: appliedCrop ? { ...appliedCrop } : null,
      state: {
        adjust: { ...state.adjust },
        curves: deepCopyCurves(state.curves),
      },
    });
  }, SAVE_DEBOUNCE_MS);
}

/**
 * Decode the saved blob, re-apply the saved crop (if any), and restore state.
 * On any failure we wipe the session — corrupted data is worse than no data.
 */
async function restoreSession(saved: Session): Promise<void> {
  const file = new File([saved.blob], saved.sourceName, { type: saved.blob.type });
  if (!isImageFile(file)) throw new Error('saved file is not an image');

  const bmp = await bitmapFromFile(file);
  const w = 'naturalWidth' in bmp ? bmp.naturalWidth : bmp.width;
  const h = 'naturalHeight' in bmp ? bmp.naturalHeight : bmp.height;
  if (!w || !h) throw new Error('saved image has invalid dimensions');

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
  originalBlob = saved.blob;
  appliedCrop = saved.appliedCrop ? { ...saved.appliedCrop } : null;

  // Re-apply the saved crop to derive the current source/preview.
  if (appliedCrop) {
    source = cropImageData(source, appliedCrop);
    const previewBox: CropBox = {
      x: (appliedCrop.x * preview.width) / originalSource.width,
      y: (appliedCrop.y * preview.height) / originalSource.height,
      w: (appliedCrop.w * preview.width) / originalSource.width,
      h: (appliedCrop.h * preview.height) / originalSource.height,
    };
    preview = cropImageData(preview, previewBox);
  }

  rebuildInteractivePreview();

  // Restore editing state. `curves.setState` mutates the widget's internal
  // state in place — and `state.curves` shares that reference (set at init).
  state.adjust = { ...saved.state.adjust };
  curves.setState(saved.state.curves);
  syncSliderInputs();

  // Clear the in-progress crop UI to defaults — we don't persist that
  cropBox = null;
  cropAspectKey = 'free';
  cropOrient = 'portrait';
  recomputeCropAspect();
  syncCropAspectButtons();
  syncCropOrientButtons();

  // History starts fresh — restored state is the new baseline
  history.clear();

  sourceName = saved.sourceName;
  drop.hidden = true;
  setToolsHidden(false);
  zoomBar.hidden = false;
  setZoom('fit');
  schedule();
  requestAnimationFrame(() => updateZoomLabel());

  toast(`sesión restaurada — ${sourceName}`, { kind: 'info', durationMs: 2500 });
}

// Boot: try to restore a saved session. If anything goes wrong, wipe and
// continue with the empty-state UI.
void (async () => {
  const saved = await loadSession();
  if (!saved) return;
  try {
    await restoreSession(saved);
  } catch (err) {
    console.error('[restore] session restore failed', err);
    await clearSession();
  }
})();
