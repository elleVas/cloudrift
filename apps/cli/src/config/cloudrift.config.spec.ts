// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { loadConfig, parseConfig } from './cloudrift.config';

describe('parseConfig', () => {
  it('parses a fully valid config', () => {
    const result = parseConfig(
      JSON.stringify({
        excludeRegions: ['us-east-1'],
        excludeTagValues: { Environment: 'Production' },
        cloudwatchWindowHours: 168,
        minAgeDays: 14,
        ignoreTag: 'keep',
        costAlertThresholdUsd: 500,
        prices: { 'eu-west-1': { 'nat-gateway': 28.5 }, default: { 'elastic-ip': 3.2 } },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({
        excludeRegions: ['us-east-1'],
        excludeTagValues: { Environment: 'Production' },
        cloudwatchWindowHours: 168,
        minAgeDays: 14,
        ignoreTag: 'keep',
        costAlertThresholdUsd: 500,
        prices: { 'eu-west-1': { 'nat-gateway': 28.5 }, default: { 'elastic-ip': 3.2 } },
      });
    }
  });

  it('rejects a prices table with a non-number value', () => {
    const result = parseConfig(
      JSON.stringify({ prices: { 'eu-west-1': { 'nat-gateway': 'cheap' } } }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('prices');
  });

  it('rejects a prices table that is not region → object', () => {
    const result = parseConfig(JSON.stringify({ prices: { 'eu-west-1': 28.5 } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('prices');
  });

  it('parses thresholds.ebsIdleMaxOps', () => {
    const result = parseConfig(JSON.stringify({ thresholds: { ebsIdleMaxOps: 50 } }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.thresholds?.ebsIdleMaxOps).toBe(50);
  });

  it('rejects a negative thresholds.ebsIdleMaxOps', () => {
    const result = parseConfig(JSON.stringify({ thresholds: { ebsIdleMaxOps: -1 } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('ebsIdleMaxOps');
  });

  it('parses thresholds.ec2CpuPercent', () => {
    const result = parseConfig(JSON.stringify({ thresholds: { ec2CpuPercent: 10 } }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.thresholds?.ec2CpuPercent).toBe(10);
  });

  it('rejects a thresholds.ec2CpuPercent outside 0-100', () => {
    const result = parseConfig(JSON.stringify({ thresholds: { ec2CpuPercent: 150 } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('ec2CpuPercent');
  });

  it('parses thresholds.rdsCpuPercent', () => {
    const result = parseConfig(JSON.stringify({ thresholds: { rdsCpuPercent: 10 } }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.thresholds?.rdsCpuPercent).toBe(10);
  });

  it('rejects a thresholds.rdsCpuPercent outside 0-100', () => {
    const result = parseConfig(JSON.stringify({ thresholds: { rdsCpuPercent: 150 } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('rdsCpuPercent');
  });

  it('parses thresholds.lambdaInvocationsMin', () => {
    const result = parseConfig(JSON.stringify({ thresholds: { lambdaInvocationsMin: 5 } }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.thresholds?.lambdaInvocationsMin).toBe(5);
  });

  it('rejects a negative thresholds.lambdaInvocationsMin', () => {
    const result = parseConfig(JSON.stringify({ thresholds: { lambdaInvocationsMin: -1 } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('lambdaInvocationsMin');
  });

  it('parses thresholds.efsIoBytesMin', () => {
    const result = parseConfig(JSON.stringify({ thresholds: { efsIoBytesMin: 1024 } }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.thresholds?.efsIoBytesMin).toBe(1024);
  });

  it('rejects a negative thresholds.efsIoBytesMin', () => {
    const result = parseConfig(JSON.stringify({ thresholds: { efsIoBytesMin: -1 } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('efsIoBytesMin');
  });

  it('parses thresholds.dynamoCapacityUtilizationPercent', () => {
    const result = parseConfig(JSON.stringify({ thresholds: { dynamoCapacityUtilizationPercent: 15 } }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.thresholds?.dynamoCapacityUtilizationPercent).toBe(15);
  });

  it('rejects a thresholds.dynamoCapacityUtilizationPercent outside 0-100', () => {
    const result = parseConfig(JSON.stringify({ thresholds: { dynamoCapacityUtilizationPercent: 150 } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('dynamoCapacityUtilizationPercent');
  });

  it('parses thresholds.sagemakerNotebookCpuPercent', () => {
    const result = parseConfig(JSON.stringify({ thresholds: { sagemakerNotebookCpuPercent: 3 } }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.thresholds?.sagemakerNotebookCpuPercent).toBe(3);
  });

  it('rejects a thresholds.sagemakerNotebookCpuPercent outside 0-100', () => {
    const result = parseConfig(JSON.stringify({ thresholds: { sagemakerNotebookCpuPercent: 150 } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('sagemakerNotebookCpuPercent');
  });

  it('returns empty config for an empty object', () => {
    const result = parseConfig('{}');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
  });

  it('ignores unknown keys (forward-compatible)', () => {
    const result = parseConfig(JSON.stringify({ minAgeDays: 3, futureKnob: true }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({ minAgeDays: 3 });
  });

  it('fails on invalid JSON', () => {
    const result = parseConfig('{ not json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('not valid JSON');
  });

  it('fails when the root is not an object', () => {
    const result = parseConfig('[1, 2, 3]');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('must be a JSON object');
  });

  it('rejects a cloudwatchWindowHours above the 7-day cap', () => {
    const result = parseConfig(JSON.stringify({ cloudwatchWindowHours: 200 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('cloudwatchWindowHours');
  });

  it('parses utilizationWindowHours', () => {
    const result = parseConfig(JSON.stringify({ utilizationWindowHours: 336 }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.utilizationWindowHours).toBe(336);
  });

  it('rejects a utilizationWindowHours above the 14-day cap', () => {
    const result = parseConfig(JSON.stringify({ utilizationWindowHours: 400 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('utilizationWindowHours');
  });

  it('rejects a negative cost threshold', () => {
    const result = parseConfig(JSON.stringify({ costAlertThresholdUsd: -1 }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('costAlertThresholdUsd');
  });

  it('rejects excludeTagValues with non-string values', () => {
    const result = parseConfig(JSON.stringify({ excludeTagValues: { Environment: 123 } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('excludeTagValues');
  });

  it('aggregates multiple validation errors', () => {
    const result = parseConfig(
      JSON.stringify({ minAgeDays: -1, ignoreTag: '', excludeRegions: 'us-east-1' }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain('minAgeDays');
      expect(result.error.message).toContain('ignoreTag');
      expect(result.error.message).toContain('excludeRegions');
    }
  });
});

describe('loadConfig', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'cloudrift-cfg-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('returns empty config when no file is present', async () => {
    const result = await loadConfig(dir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual({});
  });

  it('loads cloudrift.config.json from the cwd', async () => {
    await writeFile(join(dir, 'cloudrift.config.json'), JSON.stringify({ minAgeDays: 30 }));
    const result = await loadConfig(dir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.minAgeDays).toBe(30);
  });

  it('prefers cloudrift.config.json over .cloudriftrc', async () => {
    await writeFile(join(dir, 'cloudrift.config.json'), JSON.stringify({ minAgeDays: 1 }));
    await writeFile(join(dir, '.cloudriftrc'), JSON.stringify({ minAgeDays: 2 }));
    const result = await loadConfig(dir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.minAgeDays).toBe(1);
  });

  it('falls back to .cloudriftrc when the primary file is absent', async () => {
    await writeFile(join(dir, '.cloudriftrc'), JSON.stringify({ ignoreTag: 'keep' }));
    const result = await loadConfig(dir);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.ignoreTag).toBe('keep');
  });

  it('fails when an explicit config path does not exist', async () => {
    const result = await loadConfig(dir, 'missing.json');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('not found');
  });

  it('loads from an explicit config path', async () => {
    await writeFile(join(dir, 'custom.json'), JSON.stringify({ costAlertThresholdUsd: 100 }));
    const result = await loadConfig(dir, 'custom.json');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.costAlertThresholdUsd).toBe(100);
  });
});
