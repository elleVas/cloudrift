// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { RdsInstancePubliclyAccessible } from '../entities/rds-instance-publicly-accessible.entity';
import { RdsInstancePubliclyAccessiblePolicy } from './rds-instance-publicly-accessible.policy';

describe('RdsInstancePubliclyAccessiblePolicy', () => {
  it('flags a publicly accessible instance', () => {
    const policy = new RdsInstancePubliclyAccessiblePolicy();
    const finding = new RdsInstancePubliclyAccessible({
      dbInstanceIdentifier: 'db-1',
      region: AwsRegion.create('us-east-1'),
      accountId: '123456789012',
      detectedAt: new Date('2026-07-23'),
      tags: {},
    });
    expect(policy.evaluate(finding).flagged).toBe(true);
  });
});
