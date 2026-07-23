// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { RdsInstanceUnencrypted } from '../entities/rds-instance-unencrypted.entity';
import { RdsInstanceUnencryptedPolicy } from './rds-instance-unencrypted.policy';

describe('RdsInstanceUnencryptedPolicy', () => {
  it('flags an unencrypted instance', () => {
    const policy = new RdsInstanceUnencryptedPolicy();
    const finding = new RdsInstanceUnencrypted({
      dbInstanceIdentifier: 'db-1',
      region: AwsRegion.create('us-east-1'),
      accountId: '123456789012',
      detectedAt: new Date('2026-07-23'),
      tags: {},
    });
    expect(policy.evaluate(finding).flagged).toBe(true);
  });
});
