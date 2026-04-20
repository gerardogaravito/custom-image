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

export function toast(message: string, kind: ToastKind = 'info', durationMs = DEFAULT_DURATION_MS): void {
  const root = ensureContainer();
  const node = document.createElement('div');
  node.className = `toast toast--${kind}`;
  node.textContent = message;
  root.appendChild(node);

  requestAnimationFrame(() => node.classList.add('is-in'));

  const remove = () => {
    node.classList.remove('is-in');
    node.classList.add('is-out');
    setTimeout(() => node.remove(), 200);
  };
  const timer = window.setTimeout(remove, durationMs);
  node.addEventListener('click', () => { window.clearTimeout(timer); remove(); });
}
