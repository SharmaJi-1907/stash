/**
 * Price parsing.
 *
 * Spec: 03-ARCHITECTURE.md §4.4 · cases in 06-AGENT-BUILD-GUIDE.md §4.3
 *
 * Prices in the wild are hostile: `₹8,999.00`, `Rs. 8999`, `8,999`,
 * `INR 8999.00`, `8999.00 ₹`, and `₹8.999,00` where the separators are swapped.
 *
 * The output is always an integer in minor units — `₹2,499.00` is `249900` —
 * because floating-point currency is a bug waiting for a rainy day
 * (02-TRD.md §4.1, 06-AGENT-BUILD-GUIDE.md §1.7).
 *
 * The governing rule of this file is the last one: **when the result is not
 * clearly right, return null.** A missing price renders as no price, which is
 * honest. A wrong price is worse than nothing, because the shelf exists to help
 * a spending decision and a confidently wrong number corrupts exactly that.
 */

import type { CurrencyCode, MinorUnits } from '../../../shared/types';

export interface ParsedPrice {
  amount: MinorUnits;
  currency: CurrencyCode;
}

/** Sanity bounds in minor units. Spec: 03-ARCHITECTURE.md §4.4 rule 5. */
export const MIN_MINOR_UNITS = 100;
export const MAX_MINOR_UNITS = 100_000_000;

/** Symbol to ISO 4217. Order matters only for the multi-character entries. */
const SYMBOLS: [RegExp, CurrencyCode][] = [
  [/₹|\bRs\.?\b|\bINR\b|\brupees?\b/i, 'INR'],
  [/US\$|\bUSD\b/i, 'USD'],
  [/£|\bGBP\b/i, 'GBP'],
  [/€|\bEUR\b/i, 'EUR'],
  [/¥|\bJPY\b/i, 'JPY'],
  [/\bAUD\b|A\$/i, 'AUD'],
  [/\bCAD\b|C\$/i, 'CAD'],
  [/\bAED\b/i, 'AED'],
  [/\bSGD\b|S\$/i, 'SGD'],
  [/\$/, 'USD'],   // last: a bare $ after the qualified forms have had their turn
];

/**
 * Currencies with no minor unit. Most of the world uses two decimal places;
 * these use none, so ¥500 is 500 minor units and not 50000.
 */
const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'VND', 'CLP', 'ISK', 'XAF', 'XOF']);

export function minorUnitDigits(currency: CurrencyCode): number {
  return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}

function detectCurrency(text: string): CurrencyCode | null {
  for (const [pattern, code] of SYMBOLS) if (pattern.test(text)) return code;
  return null;
}

/**
 * Reduce the numeric part to a plain decimal string, resolving which separator
 * is the decimal point. Returns null when the shape is not a number we trust.
 *
 * Spec: 03-ARCHITECTURE.md §4.4 rule 3.
 *   · both `.` and `,` present  → the rightmost one is the decimal separator
 *   · only one present, and it is followed by exactly two digits at the end
 *     → decimal separator
 *   · otherwise                 → thousands separator
 */
function normaliseNumber(raw: string): string | null {
  // Keep digits and separators only. This also removes the `.` in "Rs." and any
  // stray currency text, which is why it happens before any separator analysis.
  let s = raw.replace(/[^\d.,]/g, '');
  s = s.replace(/^[.,]+/, '').replace(/[.,]+$/, '');
  if (!/\d/.test(s)) return null;

  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  let decimalAt = -1;

  if (lastDot >= 0 && lastComma >= 0) {
    decimalAt = Math.max(lastDot, lastComma);
  } else if (lastDot >= 0 || lastComma >= 0) {
    const only = Math.max(lastDot, lastComma);
    const tail = s.length - only - 1;
    // Exactly two trailing digits is a decimal. Three is a thousands group.
    // One is ambiguous in principle but is never a thousands group, so treat it
    // as a decimal — "8.5" is eight and a half, not eighty-five hundred.
    if (tail === 2 || tail === 1) decimalAt = only;
  }

  const integerPart = (decimalAt >= 0 ? s.slice(0, decimalAt) : s).replace(/[.,]/g, '');
  const fractionPart = decimalAt >= 0 ? s.slice(decimalAt + 1).replace(/[.,]/g, '') : '';

  if (!/^\d+$/.test(integerPart)) return null;
  if (fractionPart && !/^\d+$/.test(fractionPart)) return null;

  return fractionPart ? `${integerPart}.${fractionPart}` : integerPart;
}

/**
 * Parse a price from anything a page might carry: a string, or the number that
 * JSON-LD sometimes uses.
 *
 * `hintCurrency` is an explicit `priceCurrency` field and wins over any symbol
 * found in the text — spec rule 1.
 *
 * Returns null rather than a guess whenever the input is not clearly a price.
 */
export function parsePrice(
  raw: string | number | null | undefined,
  hintCurrency?: string | null,
): ParsedPrice | null {
  if (raw === null || raw === undefined) return null;

  const text = String(raw).trim();
  if (!text) return null;

  const currency = (hintCurrency?.trim().toUpperCase() || detectCurrency(text) || 'INR') as CurrencyCode;
  if (!/^[A-Z]{3}$/.test(currency)) return null;

  const normalised = typeof raw === 'number' ? String(raw) : normaliseNumber(text);
  if (normalised === null) return null;

  const digits = minorUnitDigits(currency);
  const [whole = '0', fraction = ''] = normalised.split('.');

  // Scale by string surgery rather than multiplication: 8999.99 * 100 is
  // 899998.9999999999 in binary floating point, and Math.round would paper over
  // a class of bug that only shows on some values.
  const padded = (fraction + '0'.repeat(digits)).slice(0, digits);
  const amount = Number(`${whole}${padded}` || '0');

  if (!Number.isSafeInteger(amount)) return null;

  // Rule 5, and it is required rather than advisory. A parse landing on ₹0.01 or
  // ₹10,00,00,000 is a parse failure wearing a plausible face.
  if (amount < MIN_MINOR_UNITS || amount > MAX_MINOR_UNITS) return null;

  return { amount, currency };
}

/** Format minor units back for display and for tests to read. */
export function formatMinorUnits(amount: MinorUnits, currency: CurrencyCode): string {
  const digits = minorUnitDigits(currency);
  const s = String(amount).padStart(digits + 1, '0');
  const whole = digits ? s.slice(0, -digits) : s;
  const fraction = digits ? s.slice(-digits) : '';
  return fraction ? `${whole}.${fraction} ${currency}` : `${whole} ${currency}`;
}
