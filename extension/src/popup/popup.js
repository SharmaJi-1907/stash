/**
 * The confirmation popup.
 *
 * Spec: 02-TRD.md §3.2 · 04-DESIGN-SYSTEM.md §7.3
 *
 * The Save button is enabled from the first frame and never waits for the
 * scrape. Pressing it while the title still says "reading the page…" saves the
 * item and lets the metadata land afterwards. This is the single most important
 * behaviour in the product — 01-PRD.md principle 1.
 */

import { saveItem, NotConfigured, ensureScraper } from '../shared.js';

/** @param {string} id @returns {HTMLElement} */
const $ = (id) => /** @type {HTMLElement} */ (document.getElementById(id));
/** @param {string} id @returns {HTMLInputElement} */
const $input = (id) => /** @type {HTMLInputElement} */ (document.getElementById(id));
/** @param {string} id @returns {HTMLTextAreaElement} */
const $area = (id) => /** @type {HTMLTextAreaElement} */ (document.getElementById(id));
/** @param {string} id @returns {HTMLButtonElement} */
const $button = (id) => /** @type {HTMLButtonElement} */ (document.getElementById(id));
let scraped = null;
let tabUrl = '';

function setStatus(text, kind = '') {
  const el = $('status');
  el.textContent = text;
  el.className = `status ${kind}`;
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabUrl = tab?.url ?? '';

  try {
    $('site').textContent = new URL(tabUrl).hostname.replace(/^www\./, '');
  } catch {
    $('site').textContent = tabUrl;
  }

  if (!/^https?:/i.test(tabUrl)) {
    setStatus('Only http(s) pages can be saved.', 'bad');
    $button('save').disabled = true;
    return;
  }

  // Fill in behind the user. If this never arrives, Save still works.
  try {
    const reply = await ensureScraper(tab.id);
    if (!reply) {
      // Say so. A blank line here looks identical to a page with no metadata,
      // and that ambiguity cost a debugging round already.
      $('price').textContent = 'Could not read this page. Saving the link only.';
    }
    if (reply) {
      scraped = reply.scraped;
      if (!$input('title').value && scraped.title) $input('title').value = scraped.title;
      if (scraped.priceText) {
        $('price').textContent = `Price on the page: ${scraped.priceText}`;
      } else {
        // Say so rather than leaving a blank space. A missing price that looks
        // like nothing is a bug that never gets reported.
        const d = reply.diagnostics ?? {};
        const found = [
          d.jsonLd ? 'JSON-LD' : null,
          d.ogTitle ? 'og tags' : null,
          d.selectorHit ? 'a price selector' : null,
          d.scanHit ? 'price-shaped text' : null,
        ].filter(Boolean);
        $('price').textContent = found.length
          ? `No price read. Page has: ${found.join(', ')}.`
          : 'No price found on this page.';
      }
    }
  } catch (e) {
    $('price').textContent = 'Could not read this page. Saving the link only.';
  }
}

$button('save').addEventListener('click', async () => {
  $button('save').disabled = true;
  setStatus('Saving…');
  try {
    const result = await saveItem({
      url: tabUrl,
      note: $area('note').value,
      title: $input('title').value,
      scraped: scraped ?? undefined,
    });
    setStatus(result.duplicate ? 'Already on your shelf' : 'Saved', 'ok');
    setTimeout(() => window.close(), 700);
  } catch (e) {
    if (e instanceof NotConfigured) { chrome.runtime.openOptionsPage(); return; }
    setStatus(String(e.message || e), 'bad');
    $button('save').disabled = false;
  }
});

$area('note').addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') $('save').click();
});

init();
