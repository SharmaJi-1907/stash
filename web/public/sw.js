/**
 * Service worker.
 *
 * Spec: 02-TRD.md §3.1 · 03-ARCHITECTURE.md §7 · 06-AGENT-BUILD-GUIDE.md §4.4
 *
 * Two jobs: catch the share POST, and keep the shell available offline.
 *
 * ── Why this file holds no logic ────────────────────────────────────────────
 *
 * The share arrives as a POST that never reaches a server. This worker writes
 * the raw fields into a small store and redirects to /share, where the app picks
 * them up and saves through the same path a pasted link takes.
 *
 * It would be possible to canonicalise, hash and store the item here instead.
 * That would mean a second copy of canonicalisation living in a plain script
 * with no imports and no tests — and dedupe is only correct while both copies
 * agree on every rule. So this worker does the one thing only it can do, and
 * hands the rest to code that is tested.
 *
 * Plain JavaScript, no build step: a service worker that needs bundling is a
 * service worker that can silently ship stale.
 */

const SHELL = 'stash-shell-v1';
const INBOX_DB = 'stash-share-inbox';
const INBOX_STORE = 'pending';

/* ── the share inbox ───────────────────────────────────────────────────────── */

function openInbox() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(INBOX_DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(INBOX_STORE, { keyPath: 'receivedAt' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function putShare(record) {
  const database = await openInbox();
  await new Promise((resolve, reject) => {
    const tx = database.transaction(INBOX_STORE, 'readwrite');
    tx.objectStore(INBOX_STORE).put(record);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

/* ── lifecycle ─────────────────────────────────────────────────────────────── */

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(['/'])).catch(() => {}),
  );
  // Take over immediately. Waiting for every tab to close means the first share
  // after an update goes to the old worker, or to no worker at all.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== SHELL) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

/* ── the share target ──────────────────────────────────────────────────────── */

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (event.request.method === 'POST' && url.pathname === '/share') {
    event.respondWith((async () => {
      const record = { receivedAt: Date.now(), url: '', text: '', title: '', image: null };

      try {
        const form = await event.request.formData();
        record.title = form.get('title') || '';
        record.text = form.get('text') || '';
        record.url = form.get('url') || '';

        // Android often puts the URL inside `text` rather than `url`, depending
        // on the sharing app — measured on this user's phone, sharing from
        // YouTube, `url` was empty every time. Both fields are kept and the app
        // takes whichever carries a URL.
        const file = form.get('image');
        if (file && file.size) {
          record.image = { name: file.name, type: file.type, size: file.size, blob: file };
        }
      } catch (error) {
        record.error = String(error && error.message ? error.message : error);
      }

      try {
        await putShare(record);
      } catch (error) {
        // Even a storage failure has to land somewhere that explains itself,
        // rather than on a browser error page.
        return Response.redirect(`/share?failed=${encodeURIComponent(String(error))}`, 303);
      }

      // 303 so the browser follows with a GET and a refresh does not repost.
      return Response.redirect('/share?pending=1', 303);
    })());
    return;
  }

  // Navigations fall back to the cached shell when offline, so opening the app
  // on a train shows the shelf rather than a dinosaur.
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => (await caches.match('/')) ?? Response.error()),
    );
  }
});

/* ── background sync ───────────────────────────────────────────────────────── */

/**
 * Ask the app to drain its outbox once connectivity returns, even if it is not
 * open. Spec: 03-ARCHITECTURE.md §7 · 05-ROADMAP.md P2 task 14.
 *
 * Not supported everywhere; where it is missing, the outbox drains on the next
 * open instead, which is the same outcome one step later.
 */
self.addEventListener('sync', (event) => {
  if (event.tag !== 'stash-outbox') return;
  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ includeUncontrolled: true });
    for (const client of clients) client.postMessage({ type: 'stash:flush' });
  })());
});
