// SPDX-License-Identifier: Apache-2.0
/**
 * Fetches every page and accumulates the result of `select` per page.
 * Deliberate copy of `dead-resources-infrastructure-aws-adapter`'s own
 * `paginate` (ADR-0078) rather than a shared import — keeps this
 * infrastructure lib decoupled from that one, at the cost of duplicating a
 * ~15-line, fully generic utility.
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
