/**
 * Theme selection.
 *
 * Spec: 04-DESIGN-SYSTEM.md §10 — a `data-theme` attribute on <html>, defaulting
 * to prefers-color-scheme with a user override, persisted locally.
 *
 * Dark is the default because the primary usage context is evening, in bed,
 * one-handed (§2.3). Light is a full peer, not an afterthought — both themes are
 * held to the same contrast floor, which `npm run check:contrast` enforces.
 */

export type Theme = 'dark' | 'light' | 'system';

const KEY = 'stash:theme';

export function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'dark' || value === 'light' ? value : 'system';
  } catch {
    // A private window, or storage disabled. Fall back rather than fail — the
    // app has to render either way.
    return 'system';
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);

  try {
    if (theme === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // The attribute is already set; persistence is a convenience, not the point.
  }
}

/** What the user is actually looking at right now. */
export function resolvedTheme(theme: Theme): 'dark' | 'light' {
  if (theme !== 'system') return theme;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
