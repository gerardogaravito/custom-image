// HEIC/HEIF decoding is not supported natively in Chrome/Firefox (only Safari).
// We lazy-load `heic2any` (libheif WASM, ~1.15MB gz) only when needed so the
// main bundle stays small for users who never upload a HEIC.

const HEIC_MIME = new Set([
  'image/heic',
  'image/heif',
  'image/heic-sequence',
  'image/heif-sequence',
]);

const HEIC_EXT = /\.(heic|heif)$/i;

export function isHeic(f: File): boolean {
  if (f.type && HEIC_MIME.has(f.type.toLowerCase())) return true;
  return HEIC_EXT.test(f.name);
}

/* v8 ignore start -- requires browser WASM (heic2any), exercised in the browser */
type Heic2Any = (opts: {
  blob: Blob;
  toType?: string;
  quality?: number;
}) => Promise<Blob | Blob[]>;

let cached: Promise<Heic2Any> | null = null;

async function loadConverter(): Promise<Heic2Any> {
  if (!cached) {
    cached = import('heic2any').then((m) => (m.default ?? m) as unknown as Heic2Any);
  }
  return cached;
}

export async function convertHeicToPng(f: File): Promise<File> {
  const heic2any = await loadConverter();
  const result = await heic2any({ blob: f, toType: 'image/png' });
  const blob = Array.isArray(result) ? result[0] : result;
  if (!blob) throw new Error('La conversión HEIC no devolvió datos.');
  const baseName = f.name.replace(HEIC_EXT, '') || 'image';
  return new File([blob], `${baseName}.png`, { type: 'image/png' });
}
/* v8 ignore stop */
