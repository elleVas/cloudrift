// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { RdsInstancePubliclyAccessible } from './rds-instance-publicly-accessible.entity';
import type { RdsInstancePubliclyAccessibleProps } from './rds-instance-publicly-accessible.entity';

function makeFinding(overrides: Partial<RdsInstancePubliclyAccessibleProps> = {}): RdsInstancePubliclyAccessible {
  return new RdsInstancePubliclyAccessible({
    dbInstanceIdentifier: 'db-1',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('RdsInstancePubliclyAccessible', () => {
  it('exposes id, kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('db-1');
    expect(finding.kind).toBe('rds-instance-publicly-accessible');
    expect(finding.severity).toBe('critical');
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
    expect(finding.riskReason).toContain('publicly accessible');
  });
});
