/**
 * Settings and the API call, shared by the background worker, the popup and the
 * options page.
 *
 * The token is entered by hand at install time and lives in chrome.storage.local.
 * It is never compiled into the bundle — 02-TRD.md §6.
 */

export const DEFAULTS = { apiBase: '', deviceToken: '' };

export async function loadSettings() {
  const stored = await chrome.storage.local.get(DEFAULTS);
  return {
    apiBase: (stored.apiBase || '').trim().replace(/\/+$/, ''),
    deviceToken: (stored.deviceToken || '').trim(),
  };
}

/** @param {{ apiBase: string, deviceToken: string }} settings */
export async function saveSettings(settings) {
  await chrome.storage.local.set({
    apiBase: (settings.apiBase || '').trim().replace(/\/+$/, ''),
    deviceToken: (settings.deviceToken || '').trim(),
  });
}

export class NotConfigured extends Error {
  constructor() { super('Add your API address and token in the extension options.'); }
}

/**
 * Save an item.
 *
 * The id is generated here rather than by the server so the client owns it from
 * the first moment — 06-AGENT-BUILD-GUIDE.md §1.9.
 */
/**
 * @param {{ url: string, note?: string, title?: string,
 *           scraped?: import('../../shared/types').ScrapedMetadata,
 *           source?: import('../../shared/types').ItemSource }} options
 * @returns {Promise<import('../../shared/types').CreateItemResponse>}
 */
export async function saveItem({ url, note, title, scraped, source = 'extension' }) {
  const { apiBase, deviceToken } = await loadSettings();
  if (!apiBase || !deviceToken) throw new NotConfigured();

  const response = await fetch(`${apiBase}/items`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${deviceToken}`,
    },
    body: JSON.stringify({
      id: crypto.randomUUID(),
      url,
      note: note || undefined,
      title: title || undefined,
      source,
      scraped,
    }),
  });

  if (response.status === 401) throw new Error('Token rejected. Check it in options.');
  if (response.status === 429) throw new Error('Too many saves just now. Try again in a minute.');
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message || `Save failed (${response.status})`);
  }

  return response.json();
}

/**
 * Ask a tab for its scrape, injecting the content script first if it is not there.
 *
 * A content script only enters a page when that page loads. After the extension
 * is reloaded — or installed — every tab already open has none, and
 * chrome.tabs.sendMessage fails with "Could not establish connection". The
 * symptom is a popup with an empty title and no price, which looks exactly like
 * a page that has no metadata, so the real cause is easy to miss.
 *
 * Injecting on demand removes the whole class of problem: no page reload, no
 * instruction to remember.
 *
 * @param {number} tabId
 * @returns {Promise<{ scraped?: object, diagnostics?: object, injected: boolean } | null>}
 */
export async function ensureScraper(tabId) {
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { type: 'stash:scrape' });
    if (reply?.ok) return { scraped: reply.scraped, diagnostics: reply.diagnostics, injected: false };
  } catch {
    // No listener yet. Fall through and put one there.
  }

  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['src/content.js'] });
    const reply = await chrome.tabs.sendMessage(tabId, { type: 'stash:scrape' });
    if (reply?.ok) return { scraped: reply.scraped, diagnostics: reply.diagnostics, injected: true };
  } catch {
    // Chrome refuses injection on its own pages, the Web Store, and PDFs. The
    // save still goes ahead without a scrape.
  }

  return null;
}
