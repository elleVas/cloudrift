// SPDX-License-Identifier: Apache-2.0
import { ValueObject } from './value-object.base';

interface MoneyProps {
  amount: number;
  currency: string;
}

class Money extends ValueObject<MoneyProps> {
  constructor(amount: number, currency: string) {
    super({ amount, currency });
  }

  get amount(): number {
    return this.props.amount;
  }
}

describe('ValueObject', () => {
  it('exposes props passed to the constructor', () => {
    const m = new Money(10, 'USD');
    expect(m.amount).toBe(10);
  });

  it('equals returns true for structurally identical objects', () => {
    const a = new Money(10, 'USD');
    const b = new Money(10, 'USD');
    expect(a.equals(b)).toBe(true);
  });

  it('equals returns false when amounts differ', () => {
    const a = new Money(10, 'USD');
    const b = new Money(20, 'USD');
    expect(a.equals(b)).toBe(false);
  });

  it('equals returns false when currencies differ', () => {
    const a = new Money(10, 'USD');
    const b = new Money(10, 'EUR');
    expect(a.equals(b)).toBe(false);
  });

  it('equals is independent of prop key insertion order', () => {
    class Pair extends ValueObject<{ x: number; y: number }> {
      constructor(props: { x: number; y: number }) {
        super(props);
      }
    }
    const a = new Pair({ x: 1, y: 2 });
    const b = new Pair(JSON.parse('{"y": 2, "x": 1}'));
    expect(a.equals(b)).toBe(true);
  });

  it('equals compares nested Date values by time, not identity', () => {
    class Stamped extends ValueObject<{ at: Date }> {
      constructor(props: { at: Date }) {
        super(props);
      }
    }
    const a = new Stamped({ at: new Date('2026-01-01T00:00:00.000Z') });
    const b = new Stamped({ at: new Date('2026-01-01T00:00:00.000Z') });
    expect(a.equals(b)).toBe(true);
  });

  it('equals compares nested arrays element-by-element', () => {
    class Tagged extends ValueObject<{ tags: string[] }> {
      constructor(props: { tags: string[] }) {
        super(props);
      }
    }
    expect(new Tagged({ tags: ['a', 'b'] }).equals(new Tagged({ tags: ['a', 'b'] }))).toBe(true);
    expect(new Tagged({ tags: ['a', 'b'] }).equals(new Tagged({ tags: ['b', 'a'] }))).toBe(false);
  });
});
