/**
 * Service worker for the share-target check.
 *
 * Spec: 02-TRD.md §3.1 · 06-AGENT-BUILD-GUIDE.md §4.4 · 05-ROADMAP.md P2 task 1
 *
 * The POST that Android sends to the share target never reaches a server. It is
 * intercepted here, written to IndexedDB, and answered with a redirect so the
 * app opens showing what arrived. That is the whole mechanism the real app will
 * use, so proving it here proves the thing that matters.
 *
 * Nothing about this is a placeholder except how the result is displayed.
 */

const DB = 'stash-share-check';
const STORE = 'shares';

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: 'receivedAt' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function put(record) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || url.pathname !== '/share') return;

  event.respondWith((async () => {
    let record = { receivedAt: Date.now(), error: null };
    try {
      const form = await event.request.formData();
      const image = form.get('image');
      record = {
        ...record,
        title: form.get('title') || '',
        text: form.get('text') || '',
        url: form.get('url') || '',
        // Android often puts the URL inside `text` rather than `url`, depending
        // on the sharing app — 06-AGENT-BUILD-GUIDE.md §4.4. The real app has to
        // read whichever field carries one, so the check records both.
        imageName: image && image.name ? image.name : '',
        imageSize: image && image.size ? image.size : 0,
        imageType: image && image.type ? image.type : '',
      };
    } catch (e) {
      record.error = String(e && e.message ? e.message : e);
    }

    try {
      await put(record);
    } catch (e) {
      // Even a storage failure must still land the user somewhere that explains
      // itself, rather than on a browser error page.
      return Response.redirect('/share?failed=' + encodeURIComponent(String(e)), 303);
    }

    // 303 so the browser follows with a GET and the POST is not repeated on
    // refresh.
    return Response.redirect('/share', 303);
  })());
});
