// SPDX-License-Identifier: Apache-2.0
import { OpenSearchDomain } from './opensearch-domain.entity';
import type { OpenSearchDomainProps } from './opensearch-domain.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeDomain(overrides: Partial<OpenSearchDomainProps> = {}): OpenSearchDomain {
  return new OpenSearchDomain({
    domainName: 'my-domain',
    region,
    accountId: '123456789012',
    instanceType: 'r5.large.search',
    instanceCount: 3,
    requestsLastWindow: 0,
    metricWindowHours: 24,
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 340,
    ...overrides,
  });
}

describe('OpenSearchDomain', () => {
  it('exposes correct id and fields', () => {
    const domain = makeDomain();
    expect(domain.id).toBe('my-domain');
    expect(domain.instanceType).toBe('r5.large.search');
  });

  it('exposes kind', () => {
    expect(makeDomain().kind).toBe('opensearch-idle-domain');
  });

  it('wasteReason references the metric window and observed request count', () => {
    expect(makeDomain({ metricWindowHours: 24, requestsLastWindow: 50 }).wasteReason).toBe(
      'near-zero search/indexing requests in last 24h (50, below internal cluster chatter)',
    );
  });

  it('isIdle returns true when traffic is below the internal chatter threshold', () => {
    expect(makeDomain({ metricWindowHours: 24, requestsLastWindow: 50 }).isIdle()).toBe(true);
  });

  it('isIdle returns false when traffic is at or above the internal chatter threshold', () => {
    expect(makeDomain({ metricWindowHours: 24, requestsLastWindow: 120 }).isIdle()).toBe(false);
  });

  it('costEstimate returns the monthly cost and instance type description', () => {
    const domain = makeDomain({ instanceType: 'r5.xlarge.search', monthlyCostUsd: 680 });
    expect(domain.costEstimate.monthlyCostUsd).toBe(680);
    expect(domain.costEstimate.description).toBe('Idle r5.xlarge.search OpenSearch domain');
  });

  it('exposes the remaining props', () => {
    const detectedAt = new Date('2026-06-09');
    const domain = makeDomain({
      instanceType: 'r5.xlarge.search',
      instanceCount: 6,
      requestsLastWindow: 30,
      metricWindowHours: 48,
      region,
      accountId: '999999999999',
      tags: { env: 'prod' },
      detectedAt,
    });
    expect(domain.instanceCount).toBe(6);
    expect(domain.requestsLastWindow).toBe(30);
    expect(domain.metricWindowHours).toBe(48);
    expect(domain.region).toBe(region);
    expect(domain.accountId).toBe('999999999999');
    expect(domain.tags).toEqual({ env: 'prod' });
    expect(domain.detectedAt).toBe(detectedAt);
  });
});
