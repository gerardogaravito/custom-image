import './style.css';
import { apply } from './pipeline';
import { mountCurves } from './curves';
import { toast } from './toast';
import type { Adjust, State, Channel } from './types';
import { defaultAdjust, defaultCurves } from './types';

const MAX_PREVIEW = 1920;
const MAX_SOURCE = 4096;

const $ = <T extends Element>(q: string) => document.querySelector(q) as T;
const $$ = <T extends Element>(q: string) => Array.from(document.querySelectorAll(q)) as T[];

const view = $<HTMLCanvasElement>('#view');
const viewCtx = view.getContext('2d')!;
const file = $<HTMLInputElement>('#file');
const drop = $<HTMLDivElement>('#drop');
const tools = $<HTMLElement>('#tools');
const curveCanvas = $<HTMLCanvasElement>('#curve');
const reset = $<HTMLButtonElement>('#reset');

let source: ImageData | null = null;   // full-res (capped to MAX_SOURCE)
let preview: ImageData | null = null;  // downscaled for live edits
let sourceName = 'image';

const state: State = { adjust: defaultAdjust(), curves: defaultCurves() };

const curves = mountCurves(curveCanvas, () => { state.curves = curves.state; schedule(); });

let rafId = 0;
function schedule() {
  if (!preview) return;
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    if (!preview) return;
    const out = apply(preview, state);
    view.width = out.width; view.height = out.height;
    viewCtx.putImageData(out, 0, 0);
  });
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
    toast(`Archivo no soportado: ${f.name}`, 'error');
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

  sourceName = f.name.replace(/\.[^.]+$/, '') || 'image';
  drop.hidden = true;
  tools.hidden = false;
  schedule();
  toast(`${f.name} cargada (${w}×${h})`, 'success');
}

async function handleFile(f: File | null | undefined): Promise<void> {
  if (!f) return;
  try {
    await loadImage(f);
  } catch (err) {
    console.error('[loadImage]', err);
    const msg = err instanceof Error ? err.message : 'Error desconocido al cargar la imagen.';
    toast(msg, 'error');
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

// Surface unhandled async errors so they aren't silent
window.addEventListener('unhandledrejection', (ev) => {
  const reason = ev.reason;
  const msg = reason instanceof Error ? reason.message : String(reason ?? 'Error inesperado');
  toast(msg, 'error');
});
window.addEventListener('error', (ev) => {
  toast(ev.message || 'Error inesperado', 'error');
});

// Tabs
$$('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    const t = (btn as HTMLElement).dataset.tab!;
    $$('.tab').forEach((b) => b.classList.toggle('is-active', b === btn));
    $$('.panel').forEach((p) => { (p as HTMLElement).hidden = (p as HTMLElement).dataset.panel !== t; });
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
    schedule();
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
    toast('No hay imagen cargada.', 'error');
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
    toast('Descarga lista.', 'success');
  } catch (err) {
    console.error('[download]', err);
    const msg = err instanceof Error ? err.message : 'Error al exportar.';
    toast(msg, 'error');
  } finally {
    download.disabled = false;
  }
});
