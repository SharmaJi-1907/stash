/**
 * The shelf.
 *
 * Spec: 04-DESIGN-SYSTEM.md §5.3, §5.4, §7.6 · 01-PRD.md F5 · 05-ROADMAP.md P2 tasks 9, 10
 *
 * ── A list, not a grid ──────────────────────────────────────────────────────
 *
 * Stack is the default and Board is secondary, and that ordering is the point.
 * A grid is a browsing instrument: it presents everything as equally available
 * and invites more looking. A list is a processing instrument: it presents one
 * thing at a time, in the reading position. This product succeeds when the shelf
 * gets shorter, so the default view has to be the one that helps items leave.
 *
 * Board exists for visual recall — "the lamp, I'd know it if I saw it" — and the
 * toggle persists, because which one you want is a habit, not a per-visit
 * decision.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { ItemCard } from '../components/ItemCard';
import { listLocal, updateLocal } from '../db/local';
import { flushOutbox } from '../sync/outbox';
import { ageInDays, staleness } from '../lib/format';
import type { LocalItem } from '../db/db';
import '../components/ItemCard.css';
import './Shelf.css';

export type View = 'stack' | 'board';
/** The shelf, or what has already been decided. Spec: 01-PRD.md F7.3 */
export type Scope = 'shelf' | 'decided';
const VIEW_KEY = 'stash:view';

function storedView(): View {
  try { return localStorage.getItem(VIEW_KEY) === 'board' ? 'board' : 'stack'; }
  catch { return 'stack'; }
}

/**
 * Render only what is on screen, once the list is long enough to matter.
 *
 * 05-ROADMAP.md P2 wants 300 items rendering in under a second at 60fps on a
 * mid-range phone. Fixed card height is what makes this simple — the position of
 * row N is N times the height, with nothing to measure — and is the second
 * reason §7.1 fixes it.
 *
 * Below the threshold the whole list renders. Windowing a list of twelve costs
 * more than it saves and breaks find-in-page for no reason.
 */
const VIRTUALISE_ABOVE = 100;
const ROW_HEIGHT = 113;   // 112px card plus its 1px separator
const OVERSCAN = 6;

function useWindow(count: number, enabled: boolean) {
  const ref = useRef<HTMLUListElement>(null);
  const [range, setRange] = useState({ start: 0, end: count });

  useEffect(() => {
    if (!enabled) { setRange({ start: 0, end: count }); return; }

    const compute = () => {
      const top = window.scrollY - (ref.current?.offsetTop ?? 0);
      const start = Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN);
      const visible = Math.ceil(window.innerHeight / ROW_HEIGHT) + OVERSCAN * 2;
      setRange({ start, end: Math.min(count, start + visible) });
    };

    compute();
    addEventListener('scroll', compute, { passive: true });
    addEventListener('resize', compute);
    return () => {
      removeEventListener('scroll', compute);
      removeEventListener('resize', compute);
    };
  }, [count, enabled]);

  return { ref, range };
}

export interface ShelfProps {
  onOpen?: (id: string) => void;
}

export function Shelf({ onOpen }: ShelfProps) {
  const [items, setItems] = useState<LocalItem[] | null>(null);
  const [view, setView] = useState<View>(storedView);
  const [scope, setScope] = useState<Scope>('shelf');

  /**
   * Which cards have already been on screen.
   *
   * A card assembles the first time it appears and never again. Animating on
   * every render would mean the whole shelf shimmering on each sync, which is
   * the "entrance animations on scroll" §7.4 rules out — and it would make the
   * assembly meaningless, since it would no longer mark anything.
   */
  const seen = useRef<Set<string>>(new Set());
  const firstLoad = useRef(true);
  const [assembling, setAssembling] = useState<Set<string>>(new Set());

  const reload = () => {
    void listLocal(scope === 'decided' ? { decided: true } : {}).then((rows) => {
      // Which ids are new is decided here, not while rendering. Mutating a ref
      // during render is wrong in React generally, and specifically wrong under
      // StrictMode: the discarded first render would mark every card as already
      // seen and nothing would ever animate.
      if (firstLoad.current) {
        // The shelf as it stood when the app opened is not new. Only what
        // arrives afterwards — a save, or a sync — assembles.
        for (const row of rows) seen.current.add(row.id);
        firstLoad.current = false;
      } else {
        const fresh = rows.filter((row) => !seen.current.has(row.id)).map((row) => row.id);
        if (fresh.length) {
          for (const id of fresh) seen.current.add(id);
          setAssembling(new Set(fresh));
        }
      }
      setItems(rows);
    });
  };
  useEffect(reload, [scope]);

  useEffect(() => {
    if (assembling.size === 0) return;
    // Drop the class once the sequence has played, so a later re-render does not
    // restart it. 400ms is the whole sequence (§7.4).
    const timer = setTimeout(() => setAssembling(new Set()), 600);
    return () => clearTimeout(timer);
  }, [assembling]);

  const virtualise = view === 'stack' && (items?.length ?? 0) > VIRTUALISE_ABOVE;
  const { ref, range } = useWindow(items?.length ?? 0, virtualise);

  const shown = useMemo(
    () => (virtualise ? (items ?? []).slice(range.start, range.end) : items ?? []),
    [items, virtualise, range.start, range.end],
  );

  /** Reset the staleness clock. One tap, no modal, no form (§6). */
  async function review(id: string) {
    await updateLocal(id, {});
    const row = (await listLocal()).find((i) => i.id === id);
    if (row) {
      // reviewedAt is the field that matters and it is not part of the patch
      // shape, so it is set directly and queued as a review.
      const { db } = await import('../db/db');
      await db.items.put({ ...row, reviewedAt: Date.now(), pending: 1 });
      await db.outbox.put({
        id: crypto.randomUUID(), kind: 'review', itemId: id, payload: null,
        attempts: 0, nextAttemptAt: Date.now(), lastError: null, createdAt: Date.now(),
      });
      void flushOutbox();
    }
    reload();
  }

  function switchTo(next: View) {
    setView(next);
    try { localStorage.setItem(VIEW_KEY, next); } catch { /* a preference, not the point */ }
  }

  if (items === null) return null;

  if (items.length === 0) {
    // An empty state is an instruction, not an apology (§7.6).
    return scope === 'decided' ? (
      <div className="empty">
        <strong>Nothing decided yet.</strong>
        <span>Items you buy or drop are kept here.</span>
        <button type="button" className="shelf__view" onClick={() => setScope('shelf')}>
          Back to the shelf
        </button>
      </div>
    ) : (
      <div className="empty">
        <strong>Nothing on the shelf yet.</strong>
        <span>Share a link here from any app, or paste one.</span>
        <a className="empty__action" href="/add">Paste a link</a>
      </div>
    );
  }

  const open = items.filter((i) => i.status === 'open').length;
  const stale = items.filter((i) => staleness(ageInDays(i)) !== 'fresh' && staleness(ageInDays(i)) !== 'settling').length;

  return (
    <div className="shelf">
      <div className="shelf__bar">
        <p className="shelf__count">
          {scope === 'decided'
            ? `${items.length} decided`
            : `${open} open${stale > 0 ? ` · ${stale} waiting on a decision` : ''}`}
          {' · '}
          {/* Decided items are kept, findable and restorable — they are just not
              on the shelf. 01-PRD.md F7.3 */}
          <button type="button" className="shelf__link"
                  onClick={() => setScope(scope === 'shelf' ? 'decided' : 'shelf')}>
            {scope === 'shelf' ? 'bought & dropped' : 'back to the shelf'}
          </button>
        </p>
        <div className="shelf__views" role="group" aria-label="View">
          <button type="button" className={`shelf__view${view === 'stack' ? ' is-on' : ''}`}
                  aria-pressed={view === 'stack'} onClick={() => switchTo('stack')}>Stack</button>
          <button type="button" className={`shelf__view${view === 'board' ? ' is-on' : ''}`}
                  aria-pressed={view === 'board'} onClick={() => switchTo('board')}>Board</button>
        </div>
      </div>

      {/* A list of <li>, not divs with click handlers (§9). */}
      <ul ref={ref} className={view === 'board' ? 'board' : 'stack'}
          style={virtualise ? { height: items.length * ROW_HEIGHT, position: 'relative' } : undefined}>
        {shown.map((item, index) => (
          <li
            key={item.id}
            style={virtualise ? {
              position: 'absolute',
              top: (range.start + index) * ROW_HEIGHT,
              left: 0, right: 0,
            } : undefined}
          >
            <ItemCard
              item={item}
              assembling={assembling.has(item.id)}
              onOpen={onOpen}
              onReview={(id) => void review(id)}
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
