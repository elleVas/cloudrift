// SPDX-License-Identifier: Apache-2.0
import { UnderutilizedEc2Instance } from './underutilized-ec2-instance.entity';
import type { UnderutilizedEc2InstanceProps } from './underutilized-ec2-instance.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('eu-west-1');

function makeInstance(
  overrides: Partial<UnderutilizedEc2InstanceProps> = {},
): UnderutilizedEc2Instance {
  return new UnderutilizedEc2Instance({
    instanceId: 'i-0abc123',
    region,
    accountId: '123456789012',
    instanceType: 'm5.xlarge',
    avgCpuPercent: 2.1,
    maxCpuPercent: 4.8,
    windowDays: 14,
    launchTime: new Date('2024-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: { Env: 'prod' },
    monthlyCostUsd: 40,
    ...overrides,
  });
}

describe('UnderutilizedEc2Instance', () => {
  it('exposes correct id and fields', () => {
    const instance = makeInstance();
    expect(instance.id).toBe('i-0abc123');
    expect(instance.instanceType).toBe('m5.xlarge');
    expect(instance.windowDays).toBe(14);
  });

  it('exposes avgCpuPercent and maxCpuPercent', () => {
    const instance = makeInstance({ avgCpuPercent: 2.1, maxCpuPercent: 4.8 });
    expect(instance.avgCpuPercent).toBe(2.1);
    expect(instance.maxCpuPercent).toBe(4.8);
  });

  it('wasteReason contains the RAM/network rightsizing advisory', () => {
    expect(makeInstance().wasteReason).toContain('verify RAM/network');
  });

  it('exposes kind ec2-underutilized', () => {
    expect(makeInstance().kind).toBe('ec2-underutilized');
  });

  it('costEstimate returns the stored monthlyCostUsd', () => {
    expect(makeInstance().costEstimate.monthlyCostUsd).toBe(40);
  });

  it('costEstimate description shows the real step-down when recommendedInstanceType is set', () => {
    const instance = makeInstance({ recommendedInstanceType: 'm5.large' });
    expect(instance.recommendedInstanceType).toBe('m5.large');
    expect(instance.costEstimate.description).toContain('m5.xlarge → m5.large');
  });

  it('costEstimate description falls back to a manual-verification note with no recommendation', () => {
    expect(makeInstance().costEstimate.description).toContain('no derivable rightsizing price');
  });

  it('exposes the remaining props', () => {
    const launchTime = new Date('2023-01-01');
    const detectedAt = new Date('2026-06-09');
    const instance = makeInstance({ region, accountId: '999999999999', launchTime, detectedAt });
    expect(instance.region).toBe(region);
    expect(instance.accountId).toBe('999999999999');
    expect(instance.launchTime).toBe(launchTime);
    expect(instance.detectedAt).toBe(detectedAt);
    expect(instance.tags).toEqual({ Env: 'prod' });
  });
});
