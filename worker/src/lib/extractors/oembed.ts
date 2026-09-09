/**
 * Tier 4 — oEmbed.
 *
 * Spec: 03-ARCHITECTURE.md §4.2
 *
 * Only for providers that publish an endpoint. It earns its place because of
 * one measurement: youtube.com returns no usable HTML to a server fetch at all —
 * no og:title, no title, nothing — while its oEmbed endpoint returns title,
 * author and thumbnail without authentication. Without this rung every YouTube
 * link lands on the shelf blank.
 */

import { safeFetch } from '../ssrf';
import type { Extracted } from './types';

interface Provider {
  match: RegExp;
  endpoint: (url: string) => string;
}

const PROVIDERS: Provider[] = [
  {
    match: /(^|\.)(youtube\.com|youtu\.be)$/i,
    endpoint: (u) => `https://www.youtube.com/oembed?url=${encodeURIComponent(u)}&format=json`,
  },
  {
    match: /(^|\.)vimeo\.com$/i,
    endpoint: (u) => `https://vimeo.com/api/oembed.json?url=${encodeURIComponent(u)}`,
  },
  {
    match: /(^|\.)soundcloud\.com$/i,
    endpoint: (u) => `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(u)}`,
  },
];

export function hasOEmbed(url: string): boolean {
  try { return PROVIDERS.some((p) => p.match.test(new URL(url).hostname)); } catch { return false; }
}

export async function fromOEmbed(url: string): Promise<Extracted | null> {
  let provider: Provider | undefined;
  try {
    const host = new URL(url).hostname;
    provider = PROVIDERS.find((p) => p.match.test(host));
  } catch { return null; }
  if (!provider) return null;

  try {
    const { response } = await safeFetch(provider.endpoint(url), {
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;

    const data = await response.json<Record<string, unknown>>();
    const title = typeof data.title === 'string' ? data.title.trim() : '';
    if (!title) return null;

    return {
      title,
      image: typeof data.thumbnail_url === 'string' ? data.thumbnail_url : undefined,
      siteName: typeof data.provider_name === 'string' ? data.provider_name : undefined,
      description: typeof data.author_name === 'string' ? `by ${data.author_name}` : undefined,
      // A video has no price, so partial is the correct outcome and not a failure.
      tier: 'oembed',
      quality: 'partial',
    };
  } catch {
    return null;
  }
}
