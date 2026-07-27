// SPDX-License-Identifier: Apache-2.0

export type CsvValue = string | number | boolean | null | undefined;

function escapeCsvField(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
}

/** Minimal CSV serialization (comma-separated, quote-escaped) — no external dependency needed for this shape. */
export function toCsv(headers: readonly string[], rows: readonly CsvValue[][]): string {
  return [headers, ...rows].map((row) => row.map(escapeCsvField).join(',')).join('\n');
}
