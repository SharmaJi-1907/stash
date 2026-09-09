/**
 * Where the API address and token are entered.
 *
 * Spec: 02-TRD.md §6, §8 · 05-ROADMAP.md P1 task 17
 *
 * Saving also tests the settings, because a token typed with a missing character
 * is otherwise indistinguishable from a broken server until the next save fails
 * silently.
 */

import { loadSettings, saveSettings } from '../shared.js';

/** @param {string} id @returns {HTMLElement} */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} id @returns {HTMLInputElement} */
const $input = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));

function setStatus(text, kind = '') {
  $('status').textContent = text;
  $('status').className = `status ${kind}`;
}

(async () => {
  const settings = await loadSettings();
  $input('apiBase').value = settings.apiBase;
  $input('deviceToken').value = settings.deviceToken;
})();

$('save').addEventListener('click', async () => {
  const apiBase = $input('apiBase').value.trim().replace(/\/+$/, '');
  const deviceToken = $input('deviceToken').value.trim();

  if (!apiBase || !deviceToken) {
    setStatus('Both fields are needed.', 'bad');
    return;
  }

  await saveSettings({ apiBase, deviceToken });
  setStatus('Testing…');

  try {
    // GET /items with the smallest possible page: proves the address resolves
    // and the token is accepted, without creating anything.
    const response = await fetch(`${apiBase}/items?limit=1`, {
      headers: { authorization: `Bearer ${deviceToken}` },
    });

    if (response.status === 401) return setStatus('Saved, but the token was rejected.', 'bad');
    if (!response.ok) return setStatus(`Saved, but the server answered ${response.status}.`, 'bad');

    const { items } = await response.json();
    setStatus(`Saved. Connected — ${items.length ? 'your shelf has items' : 'your shelf is empty'}.`, 'ok');
  } catch (e) {
    setStatus(`Saved, but could not reach the server: ${e.message}`, 'bad');
  }
});
