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
});
