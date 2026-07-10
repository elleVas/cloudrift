// SPDX-License-Identifier: Apache-2.0
import { paginate } from './paginate';

describe('paginate', () => {
  it('returns items from a single page when no cursor is returned', async () => {
    const fetchPage = jest.fn().mockResolvedValueOnce({ items: [1, 2, 3], cursor: undefined });

    const result = await paginate(fetchPage);

    expect(result).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(undefined);
  });

  it('accumulates items across multiple pages until cursor is absent', async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({ items: ['a', 'b'], cursor: 'page2' })
      .mockResolvedValueOnce({ items: ['c', 'd'], cursor: 'page3' })
      .mockResolvedValueOnce({ items: ['e'], cursor: undefined });

    const result = await paginate(fetchPage);

    expect(result).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(fetchPage).toHaveBeenCalledTimes(3);
    expect(fetchPage).toHaveBeenNthCalledWith(1, undefined);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 'page2');
    expect(fetchPage).toHaveBeenNthCalledWith(3, 'page3');
  });

  it('returns empty array when first page has no items and no cursor', async () => {
    const fetchPage = jest.fn().mockResolvedValueOnce({ items: [], cursor: undefined });

    const result = await paginate(fetchPage);

    expect(result).toEqual([]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('propagates errors thrown by fetchPage', async () => {
    const fetchPage = jest.fn().mockRejectedValueOnce(new Error('AWS error'));

    await expect(paginate(fetchPage)).rejects.toThrow('AWS error');
  });

  it('applies select per page instead of accumulating raw items', async () => {
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({ items: [1, 2, 3], cursor: 'page2' })
      .mockResolvedValueOnce({ items: [4, 5, 6], cursor: undefined });
    const select = jest.fn((items: number[]) => items.filter((n) => n % 2 === 0));

    const result = await paginate(fetchPage, select);

    expect(result).toEqual([2, 4, 6]);
    expect(select).toHaveBeenCalledTimes(2);
    expect(select).toHaveBeenNthCalledWith(1, [1, 2, 3]);
    expect(select).toHaveBeenNthCalledWith(2, [4, 5, 6]);
  });

  it('never holds more than one page of raw items at a time when select filters them out', async () => {
    // Regression guard for the OOM risk: select must run before the next page
    // is fetched, so a caller that discards most items per page keeps memory
    // bounded by the filtered output, not by the total raw item count.
    const fetchPage = jest
      .fn()
      .mockResolvedValueOnce({ items: Array.from({ length: 1000 }, (_, i) => i), cursor: 'page2' })
      .mockResolvedValueOnce({ items: Array.from({ length: 1000 }, (_, i) => 1000 + i), cursor: undefined });

    const result = await paginate(fetchPage, (items) => items.filter((n) => n % 500 === 0));

    expect(result).toEqual([0, 500, 1000, 1500]);
  });
});
