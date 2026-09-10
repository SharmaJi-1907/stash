/**
 * App entry.
 *
 * Spec: 05-ROADMAP.md P2 task 2
 *
 * The theme is applied before React renders, so the first painted frame is
 * already the right colour. Setting it inside a component means a flash of the
 * wrong theme on every cold start, which on a phone opened in the dark is the
 * kind of small ugliness that makes an app feel unfinished.
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import './styles/tokens.css';
import './styles/fonts.css';
import './styles/app.css';

import { applyTheme, storedTheme } from './theme';
import { App } from './App';

applyTheme(storedTheme());

const root = document.getElementById('root');
if (!root) throw new Error('#root is missing from index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * Register the service worker, which is what puts Stash in the Android share
 * sheet at all — the share_target in the manifest only takes effect for an
 * installed PWA, and the POST it sends is answered by this worker rather than
 * by any server.
 *
 * Registered after render, not before: the first paint should not wait on it,
 * and a worker that fails to register must not stop the app from running.
 */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('[stash] service worker did not register:', error);
    });
  });

  // The worker asks for a flush when connectivity returns while the app was
  // closed. Spec: 03-ARCHITECTURE.md §7
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (event.data?.type === 'stash:flush') {
      void import('./sync/outbox').then((m) => m.flushOutbox());
    }
  });
}
