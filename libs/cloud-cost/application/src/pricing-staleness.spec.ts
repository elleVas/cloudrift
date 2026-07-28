// SPDX-License-Identifier: Apache-2.0
import { isPricesStale, PRICES_STALE_AFTER_DAYS } from './pricing-staleness';

describe('isPricesStale', () => {
  it('is false right at the start of the pricesAsOf month', () => {
    expect(isPricesStale('2026-06', new Date('2026-06-01T00:00:00Z'))).toBe(false);
  });

  it(`is false within ${PRICES_STALE_AFTER_DAYS} days of the pricesAsOf month`, () => {
    expect(isPricesStale('2026-06', new Date('2026-06-25T00:00:00Z'))).toBe(false);
  });

  it(`is true past ${PRICES_STALE_AFTER_DAYS} days since the pricesAsOf month`, () => {
    expect(isPricesStale('2026-06', new Date('2026-10-15T00:00:00Z'))).toBe(true);
  });

  it('parses the leading year-month when custom overrides are appended', () => {
    expect(isPricesStale('2025-06 + custom overrides', new Date('2026-06-12T10:00:00Z'))).toBe(true);
    expect(isPricesStale('2026-06 + custom overrides', new Date('2026-06-12T10:00:00Z'))).toBe(false);
  });

  it('is false for an unparseable pricesAsOf value', () => {
    expect(isPricesStale('unknown', new Date('2026-06-12T10:00:00Z'))).toBe(false);
  });
});
