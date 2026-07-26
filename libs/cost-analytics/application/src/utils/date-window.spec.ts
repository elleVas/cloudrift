// SPDX-License-Identifier: Apache-2.0
import { addDaysUTC, round2, startOfDayUTC, startOfMonthUTC, toYmd } from './date-window';

describe('startOfDayUTC', () => {
  it('zeroes out the time-of-day component, in UTC', () => {
    const d = new Date('2026-03-15T23:59:59.999Z');
    expect(startOfDayUTC(d).toISOString()).toBe('2026-03-15T00:00:00.000Z');
  });

  it('is idempotent on an input already at UTC midnight', () => {
    const d = new Date('2026-03-15T00:00:00.000Z');
    expect(startOfDayUTC(d).toISOString()).toBe('2026-03-15T00:00:00.000Z');
  });
});

describe('startOfMonthUTC', () => {
  it('clamps to the 1st of the month at UTC midnight', () => {
    const d = new Date('2026-03-15T23:59:59.999Z');
    expect(startOfMonthUTC(d).toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });

  it('rolls over correctly for December', () => {
    const d = new Date('2026-12-31T23:59:59.999Z');
    expect(startOfMonthUTC(d).toISOString()).toBe('2026-12-01T00:00:00.000Z');
  });
});

describe('addDaysUTC', () => {
  it('adds whole days, carrying across a month boundary', () => {
    const d = new Date('2026-01-30T00:00:00.000Z');
    expect(addDaysUTC(d, 3).toISOString()).toBe('2026-02-02T00:00:00.000Z');
  });

  it('carries across a year boundary', () => {
    const d = new Date('2026-12-30T00:00:00.000Z');
    expect(addDaysUTC(d, 5).toISOString()).toBe('2027-01-04T00:00:00.000Z');
  });

  it('supports negative days (subtracting)', () => {
    const d = new Date('2026-03-01T00:00:00.000Z');
    expect(addDaysUTC(d, -1).toISOString()).toBe('2026-02-28T00:00:00.000Z');
  });

  it('preserves the time-of-day component', () => {
    const d = new Date('2026-03-15T13:45:30.000Z');
    expect(addDaysUTC(d, 1).toISOString()).toBe('2026-03-16T13:45:30.000Z');
  });
});

describe('toYmd', () => {
  it('formats as YYYY-MM-DD regardless of the time-of-day component', () => {
    expect(toYmd(new Date('2026-03-05T23:59:59.999Z'))).toBe('2026-03-05');
  });

  it('pads single-digit months and days', () => {
    expect(toYmd(new Date('2026-01-02T00:00:00.000Z'))).toBe('2026-01-02');
  });
});

describe('round2', () => {
  it('rounds to two decimal places', () => {
    expect(round2(1.005)).toBe(1);
    expect(round2(1.005001)).toBe(1.01);
  });

  it('rounds half-up on the second decimal', () => {
    expect(round2(12.345)).toBe(12.35);
  });

  it('leaves a value already at two decimals unchanged', () => {
    expect(round2(9.99)).toBe(9.99);
  });

  it('handles zero and negative values', () => {
    expect(round2(0)).toBe(0);
    expect(round2(-4.567)).toBe(-4.57);
  });
});
