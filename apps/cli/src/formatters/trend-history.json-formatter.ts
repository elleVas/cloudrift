// SPDX-License-Identifier: Apache-2.0
import type { TrendSnapshotRecord } from 'shared-trend-store';

/** Expands each snapshot's stored payload back into an object, rather than a double-encoded JSON string. */
export function formatTrendHistoryAsJson(records: TrendSnapshotRecord[]): string {
  return JSON.stringify(
    records.map((record) => ({ ...record, payload: JSON.parse(record.payload) })),
    null,
    2,
  );
}
