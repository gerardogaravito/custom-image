export type ToastKind = 'info' | 'success' | 'error';

const DEFAULT_DURATION_MS = 3500;

let container: HTMLDivElement | null = null;

function ensureContainer(): HTMLDivElement {
  if (container) return container;
  const el = document.createElement('div');
  el.className = 'toast-stack';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  document.body.appendChild(el);
  container = el;
  return el;
}

export type ToastHandle = () => void;

export type ToastOptions = {
  kind?: ToastKind;
  /** Auto-dismiss after N ms. Use 0 (or any non-positive value) for a sticky toast. */
  durationMs?: number;
};

export function toast(message: string, options: ToastOptions = {}): ToastHandle {
  const { kind = 'info', durationMs = DEFAULT_DURATION_MS } = options;
  const root = ensureContainer();
  const node = document.createElement('div');
  node.className = `toast toast--${kind}`;
  node.textContent = message;
  root.appendChild(node);

  requestAnimationFrame(() => node.classList.add('is-in'));

  let removed = false;
  const dismiss: ToastHandle = () => {
    if (removed) return;
    removed = true;
    node.classList.remove('is-in');
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 200);
  };

  let timer = 0;
  if (durationMs > 0) timer = window.setTimeout(dismiss, durationMs);
  node.addEventListener('click', () => { window.clearTimeout(timer); dismiss(); });

  return dismiss;
}
