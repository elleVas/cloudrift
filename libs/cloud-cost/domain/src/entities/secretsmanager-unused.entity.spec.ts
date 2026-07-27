// SPDX-License-Identifier: Apache-2.0
import { SecretsManagerUnused } from './secretsmanager-unused.entity';
import type { SecretsManagerUnusedProps } from './secretsmanager-unused.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeSecret(overrides: Partial<SecretsManagerUnusedProps> = {}): SecretsManagerUnused {
  return new SecretsManagerUnused({
    arn: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-abc123',
    region,
    accountId: '123456789012',
    name: 'my-secret',
    createdDate: new Date('2026-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 0.4,
    ...overrides,
  });
}

describe('SecretsManagerUnused', () => {
  it('exposes correct id and fields', () => {
    const secret = makeSecret();
    expect(secret.id).toBe('arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-abc123');
    expect(secret.name).toBe('my-secret');
  });

  it('exposes kind', () => {
    expect(makeSecret().kind).toBe('secretsmanager-unused');
  });

  it('wasteReason is "never accessed" when lastAccessedDate is absent', () => {
    expect(makeSecret({ lastAccessedDate: undefined }).wasteReason).toBe('never accessed');
  });

  it('wasteReason references the grace period when lastAccessedDate is present', () => {
    expect(makeSecret({ lastAccessedDate: new Date('2026-01-15') }).wasteReason).toContain('grace period');
  });

  it('costEstimate returns the fixed monthly cost', () => {
    expect(makeSecret().costEstimate.monthlyCostUsd).toBe(0.4);
  });

  it('exposes the remaining props', () => {
    const createdDate = new Date('2025-01-01');
    const detectedAt = new Date('2026-06-09');
    const secret = makeSecret({ region, accountId: '999999999999', createdDate, detectedAt, tags: { env: 'prod' } });
    expect(secret.region).toBe(region);
    expect(secret.accountId).toBe('999999999999');
    expect(secret.createdDate).toBe(createdDate);
    expect(secret.detectedAt).toBe(detectedAt);
    expect(secret.tags).toEqual({ env: 'prod' });
  });
});
