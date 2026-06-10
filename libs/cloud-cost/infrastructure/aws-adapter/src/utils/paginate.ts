export async function paginate<TItem>(
  fetchPage: (cursor: string | undefined) => Promise<{ items: TItem[]; cursor: string | undefined }>,
): Promise<TItem[]> {
  const all: TItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    all.push(...page.items);
    cursor = page.cursor;
  } while (cursor !== undefined);
  return all;
}
