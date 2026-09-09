/**
 * Context menus, the keyboard command, and the save path they share.
 *
 * Spec: 02-TRD.md §3.2 · 05-ROADMAP.md P1 task 15
 *
 * A save from here goes: ask the content script for what the page shows, post
 * it, tell the user. If the content script cannot run — a PDF, a Chrome Web
 * Store page, a tab that has not finished loading — the URL is posted anyway and
 * the server's ladder takes over. A save is never blocked on the scrape.
 */

import { saveItem, NotConfigured, ensureScraper } from './shared.js';

/** @type {chrome.contextMenus.CreateProperties[]} */
const MENUS = [
  { id: 'stash-page', title: 'Stash this page', contexts: ['page', 'selection'] },
  { id: 'stash-link', title: 'Stash this link', contexts: ['link'] },
  { id: 'stash-image', title: 'Stash this image', contexts: ['image'] },
];

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    for (const menu of MENUS) chrome.contextMenus.create(menu);
  });
});

/** Ask the tab what it can see, injecting the scraper if it is not there yet. */
async function scrapeTab(tabId) {
  const result = await ensureScraper(tabId);
  return result?.scraped ?? null;
}

async function notify(tabId, text, ok = true) {
  try {
    await chrome.action.setBadgeText({ text: ok ? '✓' : '!' });
    await chrome.action.setBadgeBackgroundColor({ color: ok ? '#5DA096' : '#C4736B' });
    setTimeout(() => chrome.action.setBadgeText({ text: '' }), 2500);
  } catch { /* badges are cosmetic */ }

  if (!ok && tabId !== undefined) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (message) => console.warn('[Stash]', message),
        args: [text],
      });
    } catch { /* nothing more to do */ }
  }
}

export async function stashCurrentTab(tab, overrideUrl) {
  if (!tab?.id) return;
  const url = overrideUrl || tab.url;
  if (!url || !/^https?:/i.test(url)) {
    await notify(tab.id, 'Only http(s) pages can be saved.', false);
    return;
  }

  // Only scrape when saving the page itself. A right-click on some other link
  // on the page would otherwise attach this page's title to that link.
  const scraped = overrideUrl ? null : await scrapeTab(tab.id);

  try {
    const result = await saveItem({ url, scraped: scraped ?? undefined });
    await notify(tab.id, result.duplicate ? 'Already on your shelf' : 'Saved', true);
  } catch (e) {
    if (e instanceof NotConfigured) {
      await chrome.runtime.openOptionsPage();
      return;
    }
    await notify(tab.id, String(e.message || e), false);
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  const url = info.menuItemId === 'stash-link' ? info.linkUrl
            : info.menuItemId === 'stash-image' ? info.srcUrl
            : undefined;
  await stashCurrentTab(tab, url);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command !== 'stash-page') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await stashCurrentTab(tab);
});
