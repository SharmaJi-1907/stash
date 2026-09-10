/**
 * One thing on the shelf.
 *
 * Spec: 04-DESIGN-SYSTEM.md §7.1 and §6
 *
 * ── Age is drawn, not written ───────────────────────────────────────────────
 *
 * §6 calls this "the strongest idea in this design, and the one most likely to
 * be dropped during implementation. Do not drop it."
 *
 * The bare fact that an item is 47 days old is more decision-relevant than its
 * price, its category or its source — nothing else on the card says a decision
 * is overdue. So it gets a structural treatment: a 3px rule down the left edge
 * at 30 days, the image fading, and the age itself in signal past 60. The rule
 * appears on no other element in the product, so its meaning is unambiguous the
 * moment it is seen twice.
 *
 * What this deliberately does not do: sort stale items to the top, hide them,
 * badge a count, or notify per item. Pressure produces avoidance, and an avoided
 * shelf is a dead shelf.
 */

import { ageInDays, formatAge, formatPrice, imageUrl, staleness } from '../lib/format';
import type { LocalItem } from '../db/db';

export interface ItemCardProps {
  item: LocalItem;
  /** True the first time this card appears, so it assembles rather than blinks in. */
  assembling?: boolean;
  onOpen?: (id: string) => void;
  onReview?: (id: string) => void;
}

export function ItemCard({ item, assembling, onOpen, onReview }: ItemCardProps) {
  const days = ageInDays(item);
  const age = staleness(days);
  const stale = age === 'stale' || age === 'overdue';
  const src = imageUrl(item);

  const title = item.title ?? item.canonicalUrl;

  return (
    <article className={`card card--${age}${assembling ? ' card--assembling' : ''}`}>
      {/* The whole card is the target, so a thumb lands on it without aiming.
          A button rather than a link: this opens a view, it does not navigate
          away, and screen readers should say so. */}
      <button
        type="button"
        className="card__hit"
        onClick={() => onOpen?.(item.id)}
        aria-label={`Open ${title}`}
      />

      {src ? (
        <img
          className="card__image"
          src={src}
          alt={title}
          width={88}
          height={88}
          loading="lazy"
          decoding="async"
        />
      ) : (
        <div className="card__image card__image--none" aria-hidden="true" />
      )}

      <div className="card__body">
        <h3 className="card__title">{title}</h3>

        <div className="card__meta">
          <span className="card__price">{formatPrice(item.priceAmount, item.priceCurrency)}</span>
          <span className="card__site">{item.site ?? ''}</span>
        </div>

        <div className="card__age">
          {item.categoryId ? null : null}
          <span className={age === 'overdue' ? 'card__age--overdue' : undefined}>
            {formatAge(days)}
          </span>
          {item.pending ? <span className="card__flag"> · syncing</span> : null}
          {item.enrichment === 'failed' ? <span className="card__flag"> · no details</span> : null}
          {stale ? (
            // One tap, no modal, no form. It resets reviewedAt and the card goes
            // quiet again (§6).
            <button
              type="button"
              className="card__review"
              onClick={(e) => { e.stopPropagation(); onReview?.(item.id); }}
            >
              still want this?
            </button>
          ) : null}
        </div>
      </div>
    </article>
  );
}
