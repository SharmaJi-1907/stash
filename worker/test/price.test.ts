import { describe, it, expect } from 'vitest';
import { parsePrice, formatMinorUnits, MIN_MINOR_UNITS, MAX_MINOR_UNITS } from '../src/lib/price';

describe('the cases the build guide names', () => {
  // 06-AGENT-BUILD-GUIDE.md §4.3, verbatim.
  const cases: [string, number | null, string?][] = [
    ['₹8,999.00', 899900, 'INR'],
    ['Rs. 8999', 899900, 'INR'],
    ['8,999', 899900, 'INR'],
    ['INR 8999.00', 899900, 'INR'],
    ['$129.99', 12999, 'USD'],
    ['1.299,00 €', 129900, 'EUR'],
    ['Free', null],
    ['₹0.01', null],            // below the floor
    ['₹99,99,99,999', null],    // above the ceiling
  ];
  for (const [input, amount, currency] of cases) {
    it(`${input} -> ${amount === null ? 'null' : amount}`, () => {
      const got = parsePrice(input);
      if (amount === null) return expect(got).toBeNull();
      expect(got).toEqual({ amount, currency });
    });
  }
});

describe('which separator is the decimal point', () => {
  const cases: [string, number][] = [
    ['1,234.56', 123456],        // both, dot last  -> dot is decimal
    ['1.234,56', 123456],        // both, comma last -> comma is decimal
    ['1,234', 123400],           // one, three trailing digits -> thousands
    ['1.234', 123400],           // same, other separator
    ['12.34', 1234],             // one, two trailing digits -> decimal
    ['12,34', 1234],             // same, other separator
    ['1,23,456.78', 12345678],   // Indian grouping
    ['12,345.67', 1234567],      // Western grouping
    ['8.5', 850],                // one trailing digit -> decimal, not thousands
    ['19.999', 1999900],         // three trailing digits -> thousands, so 19,999
    ['1,000,000', 100000000],    // repeated separator, both groups thousands
    ['1.000.000', 100000000],    // the same, other separator
  ];
  for (const [input, amount] of cases) {
    it(`${input} -> ${amount}`, () => expect(parsePrice(input)?.amount).toBe(amount));
  }
});

describe('currency detection', () => {
  const cases: [string, string][] = [
    ['₹1,500', 'INR'], ['Rs 1500', 'INR'], ['Rs. 1500', 'INR'], ['INR 1500', 'INR'],
    ['$15.00', 'USD'], ['US$15.00', 'USD'], ['USD 15', 'USD'],
    ['£15.00', 'GBP'], ['€15,00', 'EUR'], ['15,00 €', 'EUR'],
    ['A$15', 'AUD'], ['C$15', 'CAD'], ['AED 150', 'AED'], ['S$15', 'SGD'],
    ['1500', 'INR'],             // no symbol at all -> default, spec rule 1
  ];
  for (const [input, currency] of cases) {
    it(`${input} -> ${currency}`, () => expect(parsePrice(input)?.currency).toBe(currency));
  }

  it('an explicit priceCurrency beats the symbol in the text', () => {
    expect(parsePrice('$1500', 'INR')).toEqual({ amount: 150000, currency: 'INR' });
  });
  it('the hint is case-insensitive', () => {
    expect(parsePrice('1500', 'usd')?.currency).toBe('USD');
  });
  it('a nonsense hint is refused rather than guessed around', () => {
    expect(parsePrice('1500', 'rupees')).toBeNull();
  });
});

describe('currencies with no minor unit', () => {
  it('¥5000 is 5000 minor units, not 500000', () =>
    expect(parsePrice('¥5000')).toEqual({ amount: 5000, currency: 'JPY' }));
  it('an explicit JPY hint does the same', () =>
    expect(parsePrice('5000', 'JPY')?.amount).toBe(5000));
});

describe('nothing usable returns null instead of a guess', () => {
  for (const input of [
    'Free', 'Out of stock', 'Contact for price', 'Price on request', 'N/A', '--',
    '', '   ', 'abc', '.', ',', '...', 'Rs.', '₹', '$',
  ]) {
    it(JSON.stringify(input), () => expect(parsePrice(input)).toBeNull());
  }
  it('null', () => expect(parsePrice(null)).toBeNull());
  it('undefined', () => expect(parsePrice(undefined)).toBeNull());
});

describe('the sanity bounds are enforced, not advisory', () => {
  it('one unit below the floor is refused', () =>
    expect(parsePrice(String((MIN_MINOR_UNITS - 1) / 100))).toBeNull());
  it('exactly the floor is accepted', () =>
    expect(parsePrice(String(MIN_MINOR_UNITS / 100))?.amount).toBe(MIN_MINOR_UNITS));
  it('exactly the ceiling is accepted', () =>
    expect(parsePrice(String(MAX_MINOR_UNITS / 100))?.amount).toBe(MAX_MINOR_UNITS));
  it('one unit above the ceiling is refused', () =>
    expect(parsePrice(String((MAX_MINOR_UNITS + 1) / 100))).toBeNull());
  it('a nine-figure rupee price is refused', () =>
    expect(parsePrice('₹99,99,99,999')).toBeNull());
  it('a one-paisa price is refused', () =>
    expect(parsePrice('₹0.01')).toBeNull());

  // Worth stating plainly, because it is a product limit and not only a guard:
  // 100,000,000 minor units is ₹10,00,000. Anything dearer than ten lakh parses
  // to null and the item shows no price at all. That is 03-ARCHITECTURE.md §4.4
  // rule 5 as written, and for a personal save-for-later shelf it is the right
  // trade — but it is a real edge, not a theoretical one.
  it('₹10,00,000 exactly is the most that can be stored', () =>
    expect(parsePrice('₹10,00,000')?.amount).toBe(100000000));
  it('₹10,00,001 is refused, and the item will show no price', () =>
    expect(parsePrice('₹10,00,001')).toBeNull());
  it('a 1.2 million rupee price is refused for the same reason', () =>
    expect(parsePrice('₹12,34,567.89')).toBeNull());
});

describe('the result is always an integer, never a float', () => {
  // 8999.99 * 100 is 899998.9999999999 in binary floating point. Anything that
  // multiplies instead of scaling by string surgery gets this wrong sometimes
  // and right most of the time, which is the worst kind of bug.
  const tricky = ['8999.99', '0.07', '1.10', '19.99', '2.67', '1234.56'];
  for (const input of tricky) {
    it(`${input} stays exact`, () => {
      const got = parsePrice(input, 'USD');
      if (!got) return;
      expect(Number.isInteger(got.amount)).toBe(true);
      expect(got.amount).toBe(Math.round(Number(input) * 100));
    });
  }
});

describe('extra decimal places are truncated, never rounded up', () => {
  // This is where scaling by string surgery differs from multiplying by 100 and
  // rounding, and it is a deliberate choice rather than an accident:
  //
  //   "1,234.5678"  truncate -> 123456   round -> 123457
  //   "1,234.565"   truncate -> 123456   round -> 123457
  //
  // Rounding invents value the page never showed. A shelf whose whole purpose is
  // to inform a spending decision should never display a price a rupee higher
  // than the seller quoted, so the extra digits are dropped rather than resolved.
  // These cases also fail if the implementation ever goes back to
  // Math.round(Number(x) * 100), which is why they are here.
  const cases: [string, number][] = [
    ['1,234.5678', 123456],
    ['1,234.565', 123456],
  ];
  for (const [input, amount] of cases) {
    it(`${input} -> ${amount}`, () => expect(parsePrice(input, 'USD')?.amount).toBe(amount));
  }
});

describe('numbers, as JSON-LD sometimes supplies them', () => {
  it('8999 as a number', () => expect(parsePrice(8999)?.amount).toBe(899900));
  it('8999.5 as a number', () => expect(parsePrice(8999.5)?.amount).toBe(899950));
  it('0.01 as a number is still below the floor', () => expect(parsePrice(0.01)).toBeNull());
});

describe('round trip', () => {
  it('formats back to something readable', () => {
    expect(formatMinorUnits(899900, 'INR')).toBe('8999.00 INR');
    expect(formatMinorUnits(5000, 'JPY')).toBe('5000 JPY');
  });
});
