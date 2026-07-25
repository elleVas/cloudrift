// SPDX-License-Identifier: Apache-2.0
export abstract class ValueObject<T extends object> {
  constructor(protected readonly props: Readonly<T>) {}

  equals(other: ValueObject<T>): boolean {
    return deepEqual(this.props, other.props);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Structural equality, independent of key insertion order (unlike
 * `JSON.stringify` comparison). Handles the shapes VO props actually take:
 * primitives, `Date`, arrays, and plain objects, recursively.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (!isRecord(a) || !isRecord(b)) return false;
  if (a instanceof Date || b instanceof Date) {
    return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => deepEqual(item, b[i]))
    );
  }
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]))
  );
}
