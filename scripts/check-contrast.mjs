/**
 * WCAG contrast check over the design tokens.
 *
 * Spec: 04-DESIGN-SYSTEM.md §9 — 4.5:1 for body text and 3:1 for large text and
 * interface boundaries, in BOTH themes. The document singles out --text-faint
 * against --surface as the value most likely to fail, so it is checked first.
 *
 * Run: node scripts/check-contrast.mjs
 */
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../web/src/styles/tokens.css', import.meta.url), 'utf8');

function tokensIn(selector) {
  const block = css.split(selector)[1]?.split('}')[0] ?? '';
  const out = {};
  for (const [, name, value] of block.matchAll(/(--[a-z-]+):\s*(#[0-9A-Fa-f]{6})/g)) {
    out[name] = value;
  }
  return out;
}

const dark = tokensIn(':root {');
const light = { ...dark, ...tokensIn('[data-theme="light"] {') };

const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

/**
 * [foreground, background, minimum, what it is for]
 *
 * The ink thresholds are above §9's floor on purpose. At a passing 4.53:1 the
 * metadata line was reported unreadable on a phone in dark mode; 4.5:1 is WCAG's
 * minimum for body text, not a target for 13px on a dark surface. These numbers
 * are what the line actually reads at now, so a regression fails here rather
 * than being noticed on a phone weeks later.
 */
const CHECKS = [
  ['--text',       '--bg',      4.5, 'body text on the page'],
  ['--text',       '--surface', 4.5, 'item title on a card'],
  ['--text-dim',   '--surface', 8.5, 'site name, secondary text'],
  ['--text-faint', '--surface', 5.8, 'metadata — the line that carries the age'],
  ['--text-faint', '--bg',      5.8, 'metadata on the page'],
  ['--signal',     '--surface', 3.0, 'the stale marker'],
  ['--signal',     '--bg',      3.0, 'the stale marker on the page'],
  ['--settled',    '--surface', 3.0, 'bought'],
  ['--drop',       '--surface', 3.0, 'dropped'],
  ['--line-strong','--surface', 3.0, 'a divider that must be seen'],
];

let failed = 0;

/**
 * The three ink levels must stay in order. Raising one without the others
 * inverts the hierarchy — the quieter colour becomes the louder one — while
 * every individual ratio still passes. That happened once already.
 */
for (const [themeName, theme] of [['dark', dark], ['light', light]]) {
  const [t, d, f] = ['--text', '--text-dim', '--text-faint'].map((k) => ratio(theme[k], theme['--surface']));
  const ordered = t > d && d > f;
  if (!ordered) failed++;
  console.log(`\n  ${themeName} — ink order  ${ordered ? 'pass' : 'FAIL'}   ` +
              `text ${t.toFixed(2)} > dim ${d.toFixed(2)} > faint ${f.toFixed(2)}`);
}

for (const [themeName, theme] of [['dark', dark], ['light', light]]) {
  console.log(`\n  ${themeName}`);
  for (const [fg, bg, min, what] of CHECKS) {
    const r = ratio(theme[fg], theme[bg]);
    const ok = r >= min;
    if (!ok) failed++;
    console.log(
      `    ${ok ? 'pass' : 'FAIL'}  ${r.toFixed(2).padStart(5)}:1  (need ${min})  ` +
      `${fg} on ${bg}  — ${what}`,
    );
  }
}

console.log(failed === 0
  ? '\n  every pair clears its threshold in both themes\n'
  : `\n  ${failed} pair(s) below threshold\n`);
process.exit(failed === 0 ? 0 : 1);
