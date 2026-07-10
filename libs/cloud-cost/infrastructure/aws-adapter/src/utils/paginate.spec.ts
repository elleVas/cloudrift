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
});
