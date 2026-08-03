// SPDX-License-Identifier: Apache-2.0

/** Type predicate for "is this string one of the literals in this readonly tuple". */
export function isOneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}
