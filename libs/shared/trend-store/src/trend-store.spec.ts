// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultTrendStoreDir, persistTrendSnapshot, readTrendSnapshots } from './trend-store';

describe('defaultTrendStoreDir', () => {
  it('points at ~/.cloudrift/trends', () => {
    expect(defaultTrendStoreDir()).toContain(join('.cloudrift', 'trends'));
  });
});

describe('persistTrendSnapshot / readTrendSnapshots', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cloudrift-trend-store-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns an empty array for an account with no history yet', async () => {
    await expect(readTrendSnapshots('123456789012', { dir })).resolves.toEqual([]);
  });

  it('persists a snapshot and reads it back', async () => {
    await persistTrendSnapshot(
      '123456789012',
      { domain: 'cloud-cost', generatedAt: '2026-07-30T10:00:00.000Z', payload: '{"totalWasteMonthlyUsd":12.5}' },
      { dir },
    );

    const rows = await readTrendSnapshots('123456789012', { dir });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      domain: 'cloud-cost',
      generatedAt: '2026-07-30T10:00:00.000Z',
      payload: '{"totalWasteMonthlyUsd":12.5}',
    });
  });

  it('keeps separate files per account', async () => {
    await persistTrendSnapshot('111111111111', { domain: 'cloud-cost', generatedAt: '2026-07-30T10:00:00.000Z', payload: '{}' }, { dir });
    await persistTrendSnapshot('222222222222', { domain: 'cloud-cost', generatedAt: '2026-07-30T11:00:00.000Z', payload: '{}' }, { dir });

    expect(await readTrendSnapshots('111111111111', { dir })).toHaveLength(1);
    expect(await readTrendSnapshots('222222222222', { dir })).toHaveLength(1);
  });

  it('orders results most-recent-first and respects domain/limit filters', async () => {
    const accountId = '123456789012';
    await persistTrendSnapshot(accountId, { domain: 'cloud-cost', generatedAt: '2026-07-28T00:00:00.000Z', payload: '{}' }, { dir });
    await persistTrendSnapshot(accountId, { domain: 'dead-resources', generatedAt: '2026-07-29T00:00:00.000Z', payload: '{}' }, { dir });
    await persistTrendSnapshot(accountId, { domain: 'cloud-cost', generatedAt: '2026-07-30T00:00:00.000Z', payload: '{}' }, { dir });

    const all = await readTrendSnapshots(accountId, { dir });
    expect(all.map((r) => r.generatedAt)).toEqual(['2026-07-30T00:00:00.000Z', '2026-07-29T00:00:00.000Z', '2026-07-28T00:00:00.000Z']);

    const costOnly = await readTrendSnapshots(accountId, { dir, domain: 'cloud-cost' });
    expect(costOnly).toHaveLength(2);
    expect(costOnly.every((r) => r.domain === 'cloud-cost')).toBe(true);

    const limited = await readTrendSnapshots(accountId, { dir, limit: 1 });
    expect(limited).toHaveLength(1);
    expect(limited[0].generatedAt).toBe('2026-07-30T00:00:00.000Z');
  });

  it('accumulates every run, never overwriting prior snapshots (full-history-forever policy)', async () => {
    const accountId = '123456789012';
    for (let i = 0; i < 5; i++) {
      await persistTrendSnapshot(accountId, { domain: 'resource-security', generatedAt: `2026-07-2${i}T00:00:00.000Z`, payload: '{}' }, { dir });
    }
    expect(await readTrendSnapshots(accountId, { dir, limit: 100 })).toHaveLength(5);
  });

  it('never throws when the target directory cannot be created (best-effort write)', async () => {
    const accountId = '123456789012';
    const blockingFilePath = join(dir, 'blocked');
    await writeFile(blockingFilePath, 'not a directory');

    await expect(
      persistTrendSnapshot(accountId, { domain: 'cloud-cost', generatedAt: '2026-07-30T00:00:00.000Z', payload: '{}' }, { dir: blockingFilePath }),
    ).resolves.toBeUndefined();
    expect(await readTrendSnapshots(accountId, { dir: blockingFilePath })).toEqual([]);
  });
});
