/**
 * The typed API client.
 *
 * Spec: 02-TRD.md §5 · 05-ROADMAP.md P2 task 6
 *
 * Nothing on a user-facing path calls this directly. Saves go to IndexedDB and
 * the outbox drains here in the background, which is what keeps a save from
 * ever waiting on a network (06-AGENT-BUILD-GUIDE.md §1.2).
 */

import type {
  CreateItemRequest, CreateItemResponse, Item, SyncResponse, UpdateItemRequest,
  UploadImageResponse,
} from '../../../shared/types';

const SETTINGS = 'stash:settings';

export interface Settings {
  apiBase: string;
  deviceToken: string;
}

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS);
    const parsed = raw ? (JSON.parse(raw) as Partial<Settings>) : {};
    return {
      apiBase: (parsed.apiBase ?? '').trim().replace(/\/+$/, ''),
      deviceToken: (parsed.deviceToken ?? '').trim(),
    };
  } catch {
    return { apiBase: '', deviceToken: '' };
  }
}

export function saveSettings(settings: Settings): void {
  localStorage.setItem(SETTINGS, JSON.stringify({
    apiBase: settings.apiBase.trim().replace(/\/+$/, ''),
    deviceToken: settings.deviceToken.trim(),
  }));
}

export class NotConfigured extends Error {
  constructor() { super('Add the API address and token in settings.'); }
}

/**
 * Thrown for a failure that retrying cannot fix.
 *
 * The distinction matters to the outbox: a rejected token or a malformed body
 * will fail identically forever, and retrying it every five minutes for a week
 * burns quota and hides the real problem. A network error is the opposite —
 * retrying is the whole point.
 */
export class PermanentError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'PermanentError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { apiBase, deviceToken } = loadSettings();
  if (!apiBase || !deviceToken) throw new NotConfigured();

  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${deviceToken}`,
      ...init.headers,
    },
  });

  if (response.status === 401) throw new PermanentError('Token rejected', 401);
  if (response.status === 413) throw new PermanentError('Too large', 413);
  // 429 is deliberately not permanent: the limiter is asking for a pause, not
  // refusing the work.
  if (response.status >= 400 && response.status < 500 && response.status !== 429) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new PermanentError(body?.error?.message ?? `Request failed (${response.status})`, response.status);
  }
  if (!response.ok) throw new Error(`Server error (${response.status})`);

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  createItem: (body: CreateItemRequest) =>
    request<CreateItemResponse>('/items', { method: 'POST', body: JSON.stringify(body) }),

  updateItem: (id: string, body: UpdateItemRequest) =>
    request<Item>(`/items/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),

  deleteItem: (id: string) =>
    request<void>(`/items/${id}`, { method: 'DELETE' }),

  reviewItem: (id: string) =>
    request<Item>(`/items/${id}/review`, { method: 'POST', body: '{}' }),

  sync: (since: number) =>
    request<SyncResponse>(`/sync?since=${since}`),

  /** U6 — the recovery path when enrichment found no image or the wrong one.
   *  Multipart, not JSON, so this bypasses `request()` rather than bending it. */
  uploadImage: async (file: Blob): Promise<UploadImageResponse> => {
    const { apiBase, deviceToken } = loadSettings();
    if (!apiBase || !deviceToken) throw new NotConfigured();

    const form = new FormData();
    form.append('image', file);

    const response = await fetch(`${apiBase}/uploads/image`, {
      method: 'POST',
      headers: { authorization: `Bearer ${deviceToken}` },
      body: form,
    });

    if (response.status === 401) throw new PermanentError('Token rejected', 401);
    if (response.status === 413) throw new PermanentError('Too large', 413);
    if (response.status >= 400 && response.status < 500) {
      const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
      throw new PermanentError(body?.error?.message ?? `Request failed (${response.status})`, response.status);
    }
    if (!response.ok) throw new Error(`Server error (${response.status})`);

    return response.json() as Promise<UploadImageResponse>;
  },

  /** Used by settings to prove the address and token before trusting them. */
  ping: () => request<{ items: Item[] }>('/items?limit=1'),
};
