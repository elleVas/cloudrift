// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { RedshiftClusterPubliclyAccessible } from './redshift-cluster-publicly-accessible.entity';
import type { RedshiftClusterPubliclyAccessibleProps } from './redshift-cluster-publicly-accessible.entity';

const region = AwsRegion.create('us-east-1');

function makeFinding(overrides: Partial<RedshiftClusterPubliclyAccessibleProps> = {}): RedshiftClusterPubliclyAccessible {
  return new RedshiftClusterPubliclyAccessible({ clusterId: 'cluster-1', region, accountId: '123456789012', detectedAt: new Date('2026-07-31'), tags: {}, ...overrides });
}

describe('RedshiftClusterPubliclyAccessible', () => {
  it('exposes id, kind and severity', () => {
    const finding = makeFinding();
    expect(finding.id).toBe('cluster-1');
    expect(finding.kind).toBe('redshift-cluster-publicly-accessible');
    expect(finding.severity).toBe('critical');
  });

  it('exposes the remaining props', () => {
    const finding = makeFinding({ tags: { env: 'prod' } });
    expect(finding.clusterId).toBe('cluster-1');
    expect(finding.region).toBe(region);
    expect(finding.tags).toEqual({ env: 'prod' });
    expect(finding.riskReason).toContain('publicly accessible');
  });
});
