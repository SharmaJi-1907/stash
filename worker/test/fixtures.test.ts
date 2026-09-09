import { describe, it, expect } from 'vitest';
import { extract } from '../src/lib/enrich';
import fixtures from './fixtures/links.json';

/**
 * The acceptance test for enrichment. Spec: 01-PRD.md F2 acceptance, 02-TRD.md §10.
 *
 * At least 16 of 20 must reach `rich` or `partial` without manual input.
 *
 * This hits the live internet, so it is slow and it can be affected by a site
 * being down. It is not run by `npm test`; run it deliberately with
 * `npm run test:fixtures` whenever the ladder is touched.
 */

const REQUIRED = 16;

describe('the twenty-link fixture set', () => {
  it(
    `reaches ${REQUIRED} of ${fixtures.links.length} without manual input`,
    { timeout: 300_000 },
    async () => {
      const rows: { id: string; tier: string; title: string; price: string }[] = [];

      for (const link of fixtures.links) {
        let tier = '—', title = '', price = '';
        try {
          const r = await extract(link.url);
          if (r) {
            tier = `${r.tier}/${r.quality}`;
            title = (r.title ?? '').slice(0, 44);
            price = r.price ? `${r.price.amount / 100} ${r.price.currency}` : '';
          }
        } catch (e) {
          tier = `blocked`;
        }
        rows.push({ id: link.id, tier, title, price });
      }

      const usable = rows.filter((r) => r.tier !== '—' && r.tier !== 'blocked');

      console.log('\n  id             tier              price          title');
      console.log('  ' + '-'.repeat(78));
      for (const r of rows) {
        console.log(`  ${r.id.padEnd(14)} ${r.tier.padEnd(17)} ${r.price.padEnd(14)} ${r.title}`);
      }
      console.log(`\n  usable: ${usable.length}/${rows.length}   (need ${REQUIRED})`);
      console.log(`  with a price: ${rows.filter((r) => r.price).length}`);

      expect(usable.length).toBeGreaterThanOrEqual(REQUIRED);
    },
  );
});
