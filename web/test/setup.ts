/**
 * A real IndexedDB implementation for Node, and a clean database per test.
 *
 * Dexie talks to whatever `indexedDB` is on globalThis, so this is enough to
 * exercise the actual store rather than a mock of it — transactions, indexes and
 * all. A mocked database would happily accept the two writes that are supposed
 * to be atomic and prove nothing.
 */
import 'fake-indexeddb/auto';
import { beforeEach, afterEach, vi } from 'vitest';

/**
 * Node has no localStorage. The client keeps the API address and token there, so
 * the tests need one that behaves — including throwing nothing when it is empty,
 * which is the state every test starts in.
 */
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => [...store.keys()][i] ?? null,
      get length() { return store.size; },
    },
    configurable: true,
  });
}

import { db } from '../src/db/db';

beforeEach(async () => {
  await db.open();
  await db.transaction('rw', db.items, db.outbox, db.meta, async () => {
    await db.items.clear();
    await db.outbox.clear();
    await db.meta.clear();
  });
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
