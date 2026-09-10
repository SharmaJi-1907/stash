/**
 * Picking up what the service worker caught.
 *
 * Spec: 06-AGENT-BUILD-GUIDE.md §4.4 · 03-ARCHITECTURE.md §7
 *
 * The worker writes the raw share here and redirects to /share. This reads it,
 * hands it to the ordinary save path, and clears it — so a share becomes an item
 * through exactly the same code a pasted link uses, with the same dedupe and the
 * same outbox behind it.
 */

const DB = 'stash-share-inbox';
const STORE = 'pending';

export interface PendingShare {
  receivedAt: number;
  url?: string;
  text?: string;
  title?: string;
  image?: { name: string; type: string; size: number; blob: Blob } | null;
  error?: string;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'receivedAt' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/** Everything waiting, newest first. */
export async function takePendingShares(): Promise<PendingShare[]> {
  let database: IDBDatabase;
  try {
    database = await open();
  } catch {
    // No inbox yet, or storage refused. A share that cannot be read is not worth
    // an error screen — the paste field is right there.
    return [];
  }

  const records = await new Promise<PendingShare[]>((resolve, reject) => {
    const request = database.transaction(STORE, 'readonly').objectStore(STORE).getAll();
    request.onsuccess = () => resolve(request.result as PendingShare[]);
    request.onerror = () => reject(request.error);
  }).catch(() => [] as PendingShare[]);

  return records.sort((a, b) => b.receivedAt - a.receivedAt);
}

/** Clear one, once it has become an item. */
export async function clearShare(receivedAt: number): Promise<void> {
  try {
    const database = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(receivedAt);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Leaving a stale entry behind is harmless: the next open shows it again and
    // dedupe means saving it twice produces one item.
  }
}
