// Session persistence via IndexedDB. Stores the original uploaded blob plus
// the editing state (adjust, curves, applied crop) so the user can refresh /
// close the tab without losing progress.
//
// Why IndexedDB and not localStorage:
//  - localStorage is string-only (would need base64 → 33% bigger).
//  - localStorage caps at ~5-10 MB. A typical iPhone photo is 3-8 MB. We'd hit
//    the limit fast.
//  - IndexedDB stores Blob natively (no encoding) and has a much larger quota
//    (typically 50 MB+ without prompting).

import type { Adjust, Curves } from './types';
import type { CropBox } from './crop';

const DB_NAME = 'imagen-garavito';
const DB_VERSION = 1;
const STORE = 'session';
const KEY = 'current';

export type Session = {
  schemaVersion: 1;
  sourceName: string;
  /** The user's uploaded file (post-HEIC conversion if applicable). Re-decoded on restore. */
  blob: Blob;
  /** Cumulative crop in ORIGINAL source-pixel coords, or null if no crop has been applied. */
  appliedCrop: CropBox | null;
  state: { adjust: Adjust; curves: Curves };
};

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveSession(session: Session): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(session, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
  } catch (err) {
    // Quota exceeded, private browsing without IDB, etc. Best-effort.
    console.warn('[persist] saveSession failed', err);
  }
}

export async function loadSession(): Promise<Session | null> {
  try {
    const db = await openDB();
    const data = await new Promise<Session | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve(req.result as Session | undefined);
      req.onerror = () => reject(req.error);
    });
    db.close();
    if (!data) return null;
    if (data.schemaVersion !== 1) return null; // future-proofing
    return data;
  } catch (err) {
    console.warn('[persist] loadSession failed', err);
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    const db = await openDB();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
    db.close();
  } catch {
    // ignore
  }
}
