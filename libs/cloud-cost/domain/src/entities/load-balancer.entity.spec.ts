import { LoadBalancer } from './load-balancer.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

function makeLb(
  type: 'application' | 'network' = 'application',
  registeredTargetCount = 0,
): LoadBalancer {
  return new LoadBalancer({
    arn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/my-lb/abc123',
    name: 'my-lb',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    type,
    createdTime: new Date('2025-03-01'),
    detectedAt: new Date('2026-06-09'),
    registeredTargetCount,
    tags: { Team: 'platform' },
    monthlyCostUsd: 16.2,
  });
}

describe('LoadBalancer', () => {
  it('uses the ARN as entity id', () => {
    expect(makeLb().id).toBe(
      'arn:aws:elasticloadbalancing:us-east-1:123456789012:loadbalancer/app/my-lb/abc123',
    );
  });

  it('exposes name, type, and region', () => {
    const lb = makeLb('network');
    expect(lb.name).toBe('my-lb');
    expect(lb.type).toBe('network');
    expect(lb.region.code).toBe('us-east-1');
  });

  it('isIdle returns true when no targets are registered', () => {
    expect(makeLb('application', 0).isIdle()).toBe(true);
  });

  it('isIdle returns false when targets are registered', () => {
    expect(makeLb('application', 3).isIdle()).toBe(false);
  });

  it('exposes kind and wasteReason', () => {
    expect(makeLb().kind).toBe('load-balancer');
    expect(makeLb().wasteReason).toContain('no registered targets');
  });

  it('costEstimate returns stored monthlyCostUsd', () => {
    expect(makeLb('application').costEstimate.monthlyCostUsd).toBe(16.2);
    expect(makeLb('network').costEstimate.monthlyCostUsd).toBe(16.2);
  });

  it('costEstimate description references the LB type', () => {
    expect(makeLb('application').costEstimate.description).toContain('application');
  });

  it('equals another LB with the same ARN', () => {
    expect(makeLb().equals(makeLb())).toBe(true);
  });

  it('exposes tags', () => {
    expect(makeLb().tags).toEqual({ Team: 'platform' });
  });
});
