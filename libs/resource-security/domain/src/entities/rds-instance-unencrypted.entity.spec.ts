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
});
