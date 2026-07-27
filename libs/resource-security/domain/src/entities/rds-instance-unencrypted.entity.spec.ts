// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { RdsInstanceUnencrypted } from './rds-instance-unencrypted.entity';
import type { RdsInstanceUnencryptedProps } from './rds-instance-unencrypted.entity';

function makeFinding(overrides: Partial<RdsInstanceUnencryptedProps> = {}): RdsInstanceUnencrypted {
  return new RdsInstanceUnencrypted({
    dbInstanceIdentifier: 'db-1',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('RdsInstanceUnencrypted', () => {
  it('exposes id, kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('db-1');
    expect(finding.kind).toBe('rds-instance-unencrypted');
    expect(finding.severity).toBe('warning');
  });

  it('exposes the remaining props', () => {
    const detectedAt = new Date('2026-07-23');
    const region = AwsRegion.create('eu-west-1');
    const finding = makeFinding({ dbInstanceIdentifier: 'db-9', region, accountId: '999999999999', detectedAt, tags: { env: 'prod' } });
    expect(finding.dbInstanceIdentifier).toBe('db-9');
    expect(finding.region).toBe(region);
    expect(finding.accountId).toBe('999999999999');
    expect(finding.detectedAt).toBe(detectedAt);
    expect(finding.tags).toEqual({ env: 'prod' });
    expect(finding.riskReason).toContain('not encrypted at rest');
  });
});
