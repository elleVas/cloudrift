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
});
