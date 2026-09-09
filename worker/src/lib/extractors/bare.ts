/**
 * Tier 5 — bare HTML.
 *
 * Spec: 03-ARCHITECTURE.md §4.2
 *
 * The last rung before giving up: the <title> element, the description meta, and
 * the first image that is plausibly a picture of something rather than a logo or
 * a tracking pixel. It will often be imperfect — that is the point. An item on
 * the shelf with a rough title beats an item that was never saved
 * (01-PRD.md principle 1).
 */

import type { Collected } from './collect';
import type { Extracted } from './types';

/** Site names tacked onto a <title> add nothing once `site` is stored separately. */
function trimSuffix(title: string): string {
  const cut = title.split(/\s+[|–—·-]\s+/);
  if (cut.length > 1) {
    const last = cut[cut.length - 1]!;
    if (last.length <= 30 && cut.slice(0, -1).join(' ').length >= 12) {
      return cut.slice(0, -1).join(' - ').trim();
    }
  }
  return title.trim();
}

export function fromBareHtml(c: Collected): Extracted | null {
  const title = trimSuffix(c.title);
  if (!title || title.length < 3) return null;

  return {
    title,
    description: c.description.trim() || undefined,
    image: c.images[0],
    tier: 'bare',
    quality: 'partial',
  };
}
