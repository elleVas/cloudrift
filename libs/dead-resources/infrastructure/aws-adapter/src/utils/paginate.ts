// SPDX-License-Identifier: Apache-2.0
/**
 * Fetches every page and accumulates the result of `select` per page.
 * Deliberate copy of `cloud-cost-infrastructure-aws-adapter`'s own
 * `paginate` (ADR-0078) rather than a shared import — keeps this
 * infrastructure lib decoupled from that one, at the cost of duplicating a
 * ~15-line, fully generic utility. Revisit (move to `shared-kernel`) if a
 * third AWS-touching infra lib ever needs it too.
 */
export function paginate<TItem>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: TItem[]; cursor: string | undefined }>,
): Promise<TItem[]>;
export function paginate<TItem, TResult>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: TItem[]; cursor: string | undefined }>,
  select: (items: TItem[]) => TResult[],
): Promise<TResult[]>;
export async function paginate<TItem, TResult>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: TItem[]; cursor: string | undefined }>,
  select?: (items: TItem[]) => TResult[],
): Promise<(TItem | TResult)[]> {
  const all: (TItem | TResult)[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    all.push(...(select ? select(page.items) : page.items));
    cursor = page.cursor;
  } while (cursor !== undefined);
  return all;
}
