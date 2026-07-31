// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { RedshiftClusterPubliclyAccessible } from '../entities/redshift-cluster-publicly-accessible.entity';
import { RedshiftClusterPubliclyAccessiblePolicy } from './redshift-cluster-publicly-accessible.policy';

const region = AwsRegion.create('us-east-1');

describe('RedshiftClusterPubliclyAccessiblePolicy', () => {
  it('flags — the scanner only emits already-public clusters', () => {
    const finding = new RedshiftClusterPubliclyAccessible({ clusterId: 'cluster-1', region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: {} });
    expect(new RedshiftClusterPubliclyAccessiblePolicy().evaluate(finding).flagged).toBe(true);
  });

  it('respects the exclusion tag', () => {
    const finding = new RedshiftClusterPubliclyAccessible({ clusterId: 'cluster-1', region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: { 'cloudrift:ignore': 'true' } });
    expect(new RedshiftClusterPubliclyAccessiblePolicy().evaluate(finding).flagged).toBe(false);
  });
});
