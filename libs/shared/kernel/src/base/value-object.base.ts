// SPDX-License-Identifier: Apache-2.0
export abstract class ValueObject<T extends object> {
  constructor(protected readonly props: Readonly<T>) {}

  equals(other: ValueObject<T>): boolean {
    return deepEqual(this.props, other.props);
  }
}

/**
 * Structural equality, independent of key insertion order (unlike
 * `JSON.stringify` comparison). Handles the shapes VO props actually take:
 * primitives, `Date`, arrays, and plain objects, recursively.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => deepEqual(item, b[i]))
    );
  }
  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => Object.prototype.hasOwnProperty.call(bObj, key) && deepEqual(aObj[key], bObj[key]))
  );
}
