/**
 * One item, in full.
 *
 * Spec: 04-DESIGN-SYSTEM.md §7.2, §9 · 01-PRD.md F5.4, F7 · 05-ROADMAP.md P2 task 11
 *
 * Every decision reachable by a swipe on the shelf is reachable by a button
 * here. §9 is explicit: "gesture-only functionality is not acceptable." A phone
 * held in one hand is the common case, not the only one, and a shelf that can
 * only be worked with a thumb cannot be worked with a keyboard at all.
 */

import { useEffect, useState } from 'react';
import { deleteLocal, getLocal, updateLocal } from '../db/local';
import { flushOutbox } from '../sync/outbox';
import { ageInDays, formatAge, formatPrice, imageUrl, staleness } from '../lib/format';
import { navigate } from '../router';
import type { LocalItem } from '../db/db';
import type { ItemStatus } from '../../../shared/types';
import './ItemDetail.css';

export interface ItemDetailProps { id: string }

export function ItemDetail({ id }: ItemDetailProps) {
  const [item, setItem] = useState<LocalItem | null | undefined>(undefined);
  const [note, setNote] = useState('');

  useEffect(() => {
    void getLocal(id).then((row) => {
      setItem(row ?? null);
      setNote(row?.note ?? '');
    });
  }, [id]);

  if (item === undefined) return null;

  if (item === null) {
    return (
      <div className="empty">
        <strong>That item is not here.</strong>
        <span>It may have been dropped, or it lives on another device and has not synced yet.</span>
        <a className="empty__action" href="/">Back to the shelf</a>
      </div>
    );
  }

  const days = ageInDays(item);
  const age = staleness(days);
  const src = imageUrl(item);
  const title = item.title ?? item.canonicalUrl;

  async function decide(status: ItemStatus) {
    const next = await updateLocal(item!.id, { status });
    if (next) setItem(next);
    void flushOutbox();
    // Bought and dropped leave the shelf, so there is nothing to come back to.
    if (status === 'bought' || status === 'dropped') navigate('/');
  }

  async function saveNote() {
    const next = await updateLocal(item!.id, { note: note.trim() || null });
    if (next) setItem(next);
    void flushOutbox();
  }

  async function drop() {
    await deleteLocal(item!.id);
    void flushOutbox();
    navigate('/');
  }

  return (
    <article className="detail">
      {src ? (
        <img className="detail__image" src={src} alt={title} loading="eager" decoding="async" />
      ) : (
        <div className="detail__image detail__image--none" aria-hidden="true" />
      )}

      <h2 className="detail__title">{title}</h2>

      <dl className="detail__facts">
        <div><dt>Price</dt><dd>{formatPrice(item.priceAmount, item.priceCurrency)}</dd></div>
        <div><dt>From</dt><dd>{item.site ?? '—'}</dd></div>
        <div>
          <dt>On the shelf</dt>
          {/* Age is a first-class field here too, not a footnote. */}
          <dd className={age === 'overdue' ? 'detail__overdue' : undefined}>{formatAge(days)}</dd>
        </div>
        <div><dt>Status</dt><dd>{item.status}</dd></div>
        {item.enrichment === 'failed' ? (
          <div><dt>Details</dt><dd>Could not read that page. Add a title yourself.</dd></div>
        ) : null}
        {item.pending ? <div><dt>Sync</dt><dd>Waiting to reach the server</dd></div> : null}
      </dl>

      {item.description ? <p className="detail__description">{item.description}</p> : null}

      <label className="detail__field">
        <span className="detail__label">Your note</span>
        <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} onBlur={() => void saveNote()} />
      </label>

      <div className="detail__actions">
        {/* The verb never changes between the control and its confirmation:
            "Bought" produces bought, "Drop" produces dropped (§8.1). */}
        <button type="button" className="detail__action detail__action--bought"
                onClick={() => void decide('bought')}>Bought</button>
        <button type="button" className="detail__action detail__action--drop"
                onClick={() => void decide('dropped')}>Drop</button>
        <button type="button" className="detail__action"
                onClick={() => void decide(item.status === 'shortlist' ? 'open' : 'shortlist')}>
          {item.status === 'shortlist' ? 'Remove from shortlist' : 'Shortlist'}
        </button>
      </div>

      {!item.url.startsWith('stash:manual/') ? (
        <a className="detail__open" href={item.url} target="_blank" rel="noreferrer noopener">
          Open original
        </a>
      ) : null}

      <button type="button" className="detail__delete" onClick={() => void drop()}>
        Remove from the shelf
      </button>
    </article>
  );
}
