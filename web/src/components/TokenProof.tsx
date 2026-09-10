/**
 * A sheet showing every design token as it actually renders.
 *
 * Not a screen the user will ever see. It exists so the palette, the type scale
 * and the card shape can be looked at side by side, in both themes, before any
 * screen is built on them. 04-DESIGN-SYSTEM.md §10 says to remove one thing from
 * a screen before calling it finished — that judgement needs the thing rendered,
 * not described.
 *
 * It also stands in for the shelf card until Shelf.tsx exists, which is the
 * fastest way to find out whether 112px and 88px are the right numbers.
 */

import './TokenProof.css';

const SURFACES = ['--bg', '--surface', '--surface-raised', '--surface-lit', '--line', '--line-strong'];
const INK = ['--text', '--text-dim', '--text-faint'];
const MEANING = ['--signal', '--signal-dim', '--settled', '--drop'];

const TYPE = [
  ['--t-display', 'Screen titles only'],
  ['--t-lg', 'Item title in detail view'],
  ['--t-md', 'Item title on the shelf — the workhorse'],
  ['--t-base', 'Body, notes, descriptions'],
  ['--t-sm', 'Metadata: site, age, category'],
  ['--t-xs', 'Counts, badge numerals'],
] as const;

function Swatch({ token }: { token: string }) {
  return (
    <div className="swatch">
      <div className="swatch__chip" style={{ background: `var(${token})` }} />
      <code className="swatch__name">{token}</code>
    </div>
  );
}

/**
 * The shelf card from §7.1, at the real numbers: 112px tall, an 88px image,
 * a two-line title clamp, and the price right-aligned so a column of them makes
 * a scannable edge.
 */
function Card({ ageDays, title, price, site, category }: {
  ageDays: number; title: string; price: string; site: string; category: string;
}) {
  // §6: 30 days puts a rule on the left edge and fades the image; 60 puts the
  // age itself in signal. Nothing is sorted or hidden — the point is legibility,
  // not pressure.
  const stale = ageDays >= 30;
  const overdue = ageDays >= 60;

  return (
    <article className={`card${stale ? ' card--stale' : ''}${overdue ? ' card--overdue' : ''}`}>
      <div className="card__image" aria-hidden="true" />
      <div className="card__body">
        <h3 className="card__title">{title}</h3>
        <div className="card__meta">
          <span className="card__price">{price}</span>
          <span className="card__site">{site}</span>
        </div>
        <div className="card__age">
          {category} · <span className={overdue ? 'card__age--overdue' : ''}>{ageDays}d</span>
          {stale ? ' · still want this?' : ''}
        </div>
      </div>
    </article>
  );
}

export function TokenProof() {
  return (
    <div className="proof">
      <section>
        <h2 className="proof__h">Surfaces</h2>
        <p className="proof__note">
          Elevation is surface lightness, never a shadow. There are no shadows anywhere
          in this product.
        </p>
        <div className="proof__row">{SURFACES.map((t) => <Swatch key={t} token={t} />)}</div>
      </section>

      <section>
        <h2 className="proof__h">Text</h2>
        <div className="proof__row">{INK.map((t) => <Swatch key={t} token={t} />)}</div>
        <p className="proof__note">
          <span style={{ color: 'var(--text-faint)' }}>
            This is --text-faint, which carries the age on every card.
          </span>{' '}
          §3.1 sets it darker; it fails §9&rsquo;s contrast floor there, so it is lightened.
        </p>
      </section>

      <section>
        <h2 className="proof__h">Meaning</h2>
        <p className="proof__note">
          Signal has exactly three uses — the stale marker, the primary action in a
          decision, and a price drop. Nowhere else.
        </p>
        <div className="proof__row">{MEANING.map((t) => <Swatch key={t} token={t} />)}</div>
      </section>

      <section>
        <h2 className="proof__h">Type</h2>
        {TYPE.map(([token, use]) => (
          <div key={token} className="type-row">
            <div className="type-row__sample" style={{ font: `var(${token}-w) var(${token})/var(${token}-lh) var(--font)` }}>
              Keychron K2 Pro 75%
            </div>
            <div className="type-row__label">
              <code>{token}</code> — {use}
            </div>
          </div>
        ))}
        <div className="type-row">
          <div className="type-row__sample" style={{ fontSize: 'var(--t-md)', fontWeight: 500 }}>
            साड़ी · Kurta set · ₹2,499
          </div>
          <div className="type-row__label">
            Mixed Devanagari and Latin in one line — one voice, not two
          </div>
        </div>
      </section>

      <section>
        <h2 className="proof__h">The card</h2>
        <p className="proof__note">
          Fixed 112px height and an 88px image. A uniform rhythm is what makes a long
          list scannable; ragged heights force the eye to re-find the left edge on
          every row.
        </p>
        <div className="proof__cards">
          <Card ageDays={4} title="Keychron K2 Pro 75% mechanical keyboard, brown switches"
                price="₹8,999" site="amazon.in" category="Gadgets" />
          <Card ageDays={21} title="Wooden monitor riser with a drawer"
                price="₹1,450" site="pepperfry.com" category="Home" />
          <Card ageDays={47} title="Neuro PlayGround Lite"
                price="—" site="crowdsupply.com" category="Gadgets" />
          <Card ageDays={94} title="Raspberry Pi 5 Essentials Starter Kit"
                price="₹6,200" site="amazon.in" category="Gadgets" />
        </div>
        <p className="proof__note">
          The third and fourth carry the stale rule. The fourth is past 60 days, so its
          age is in signal and the image fades further. Nothing is sorted to the top and
          nothing is hidden — nagging produces avoidance, and an avoided shelf is a dead
          shelf.
        </p>
      </section>
    </div>
  );
}
