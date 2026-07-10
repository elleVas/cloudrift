// SPDX-License-Identifier: Apache-2.0
/**
 * Fetches every page and accumulates the result of `select` per page instead of
 * the raw items themselves. Callers that filter/map down to a small subset (e.g.
 * only the wasted resources out of tens of thousands of raw entries) keep memory
 * bounded by the filtered output, not by the total item count across all pages.
 * Defaults to identity, preserving the original "accumulate everything" behavior.
 */
export async function paginate<TItem, TResult = TItem>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: TItem[]; cursor: string | undefined }>,
  select: (items: TItem[]) => TResult[] = (items) => items as unknown as TResult[],
): Promise<TResult[]> {
  const all: TResult[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    all.push(...select(page.items));
    cursor = page.cursor;
  } while (cursor !== undefined);
  return all;
}
