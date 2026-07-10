// SPDX-License-Identifier: Apache-2.0
export abstract class Entity<TId> {
  constructor(protected readonly _id: TId) {}

  get id(): TId {
    return this._id;
  }

  equals(other: Entity<TId>): boolean {
    if (!(other instanceof Entity)) return false;
    return this._id === other._id;
  }

  /**
   * Deep-freezes `value` recursively (plain objects and arrays), so
   * `Object.freeze` on a props object doesn't stop at the top level —
   * `entity.tags['x'] = 'y'` or `entity.attachedVolumes.push(...)` throw
   * in strict mode instead of silently succeeding. `Date` is left alone:
   * entities never mutate a stored Date in place, and freezing the object
   * wouldn't stop `setMonth()` anyway (Date mutators aren't property writes).
   */
  protected deepFreeze<T>(value: T): Readonly<T> {
    if (value === null || typeof value !== 'object' || value instanceof Date || Object.isFrozen(value)) {
      return value;
    }
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      this.deepFreeze((value as Record<string, unknown>)[key]);
    }
    return value;
  }
}
