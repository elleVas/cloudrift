// SPDX-License-Identifier: Apache-2.0
import { Entity } from './entity.base';

class StringEntity extends Entity<string> {
  constructor(id: string) {
    super(id);
  }
}

class NumberEntity extends Entity<number> {
  constructor(id: number) {
    super(id);
  }
}

describe('Entity', () => {
  it('exposes the id passed to the constructor', () => {
    const entity = new StringEntity('abc');
    expect(entity.id).toBe('abc');
  });

  it('equals returns true for two entities with the same id', () => {
    const a = new StringEntity('x');
    const b = new StringEntity('x');
    expect(a.equals(b)).toBe(true);
  });

  it('equals returns false for two entities with different ids', () => {
    const a = new StringEntity('x');
    const b = new StringEntity('y');
    expect(a.equals(b)).toBe(false);
  });

  it('supports numeric ids', () => {
    const a = new NumberEntity(1);
    const b = new NumberEntity(1);
    expect(a.equals(b)).toBe(true);
  });

  it('equals returns false when compared to a non-Entity', () => {
    const a = new StringEntity('x');
    expect(a.equals({} as Entity<string>)).toBe(false);
  });
});
