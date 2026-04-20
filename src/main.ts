import './style.css';
import { apply } from './pipeline';
import { mountCurves } from './curves';
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

async function loadImage(f: File) {
  const bmp = await createImageBitmap(f);
  const src = fitCanvas(bmp.width, bmp.height, MAX_SOURCE);
  const prev = fitCanvas(bmp.width, bmp.height, MAX_PREVIEW);

  const off1 = new OffscreenCanvas(src.w, src.h);
  off1.getContext('2d')!.drawImage(bmp, 0, 0, src.w, src.h);
  source = off1.getContext('2d')!.getImageData(0, 0, src.w, src.h);

  const off2 = new OffscreenCanvas(prev.w, prev.h);
  off2.getContext('2d')!.drawImage(bmp, 0, 0, prev.w, prev.h);
  preview = off2.getContext('2d')!.getImageData(0, 0, prev.w, prev.h);

  sourceName = f.name.replace(/\.[^.]+$/, '') || 'image';
  drop.hidden = true;
  tools.hidden = false;
  schedule();
}

file.addEventListener('change', () => { const f = file.files?.[0]; if (f) loadImage(f); });
drop.addEventListener('click', () => file.click());
['dragenter', 'dragover'].forEach((e) =>
  drop.addEventListener(e, (ev) => { ev.preventDefault(); drop.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((e) =>
  drop.addEventListener(e, () => drop.classList.remove('is-over')));
drop.addEventListener('drop', (ev) => {
  ev.preventDefault();
  const f = ev.dataTransfer?.files[0];
  if (f) loadImage(f);
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
  if (!source) return;
  download.disabled = true;
  try {
    const processed = apply(source, state);
    const s = Number(scale.value);
    const out = new OffscreenCanvas(
      Math.max(1, Math.round(processed.width * s)),
      Math.max(1, Math.round(processed.height * s)),
    );
    const octx = out.getContext('2d')!;
    // draw source imageData via intermediate canvas, then scale
    const tmp = new OffscreenCanvas(processed.width, processed.height);
    tmp.getContext('2d')!.putImageData(processed, 0, 0);
    octx.imageSmoothingQuality = 'high';
    octx.drawImage(tmp, 0, 0, out.width, out.height);

    const type = fmt.value === 'png' ? 'image/png' : 'image/jpeg';
    const quality = fmt.value === 'png' ? undefined : Number(q.value) / 100;
    const blob = await out.convertToBlob({ type, quality });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sourceName}-edit.${fmt.value === 'png' ? 'png' : 'jpg'}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } finally {
    download.disabled = false;
  }
});
