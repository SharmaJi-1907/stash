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
