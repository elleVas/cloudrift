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

class FreezingEntity extends Entity<string> {
  constructor(public readonly value: unknown) {
    super('id');
  }

  freeze<T>(value: T): Readonly<T> {
    return this.deepFreeze(value);
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

  describe('deepFreeze', () => {
    const entity = new FreezingEntity(undefined);

    it('freezes a nested plain object, not just the top level', () => {
      const props = entity.freeze({ tags: { env: 'prod' } });
      expect(() => {
        (props.tags as Record<string, string>).env = 'dev';
      }).toThrow(TypeError);
      expect(props.tags.env).toBe('prod');
    });

    it('freezes objects nested inside an array', () => {
      const props = entity.freeze({ volumes: [{ sizeGb: 10 }] });
      expect(() => {
        (props.volumes[0] as { sizeGb: number }).sizeGb = 99;
      }).toThrow(TypeError);
      expect(Object.isFrozen(props.volumes)).toBe(true);
    });

    it('leaves Date instances usable (does not freeze them)', () => {
      const props = entity.freeze({ createdAt: new Date('2026-01-01') });
      expect(Object.isFrozen(props.createdAt)).toBe(false);
      expect(props.createdAt.getFullYear()).toBe(2026);
    });

    it('passes primitives and null through unchanged', () => {
      expect(entity.freeze(42)).toBe(42);
      expect(entity.freeze(null)).toBe(null);
      expect(entity.freeze('x')).toBe('x');
    });
  });
});
