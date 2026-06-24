// SPDX-License-Identifier: Apache-2.0
export type Success<T> = { readonly ok: true; readonly value: T };
export type Failure<E extends Error = Error> = { readonly ok: false; readonly error: E };
export type Result<T, E extends Error = Error> = Success<T> | Failure<E>;

export const Result = {
  ok: <T>(value: T): Success<T> => ({ ok: true, value }),
  fail: <E extends Error>(error: E): Failure<E> => ({ ok: false, error }),
} as const;
