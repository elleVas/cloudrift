// SPDX-License-Identifier: Apache-2.0
import { Ec2Instance } from './ec2-instance.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('eu-west-1');

const stoppedInstance = new Ec2Instance({
  instanceId: 'i-0abc123',
  region,
  accountId: '123456789012',
  instanceType: 't3.medium',
  state: 'stopped',
  launchTime: new Date('2024-01-01'),
  detectedAt: new Date('2026-06-09'),
  attachedVolumes: [
    { volumeId: 'vol-001', sizeGb: 50, volumeType: 'gp3' },
    { volumeId: 'vol-002', sizeGb: 100, volumeType: 'gp2' },
  ],
  tags: { Env: 'dev' },
  monthlyCostUsd: 14,
  wasteReason: 'stopped 30d ago (attached EBS still billed)',
});

describe('Ec2Instance', () => {
  it('exposes correct id and fields', () => {
    expect(stoppedInstance.id).toBe('i-0abc123');
    expect(stoppedInstance.instanceType).toBe('t3.medium');
    expect(stoppedInstance.state).toBe('stopped');
    expect(stoppedInstance.attachedVolumes).toHaveLength(2);
  });

  it('isStopped returns true for stopped state', () => {
    expect(stoppedInstance.isStopped()).toBe(true);
  });

  it('isStopped returns false for running state', () => {
    const running = new Ec2Instance({
      instanceId: 'i-run', region, accountId: '123456789012', instanceType: 't3.micro',
      state: 'running', launchTime: new Date(), detectedAt: new Date(), attachedVolumes: [], tags: {}, monthlyCostUsd: 0, wasteReason: '',
    });
    expect(running.isStopped()).toBe(false);
  });

  it('costEstimate returns the stored monthlyCostUsd', () => {
    expect(stoppedInstance.costEstimate.monthlyCostUsd).toBe(14);
  });

  it('costEstimate description lists attached volume summary', () => {
    expect(stoppedInstance.costEstimate.description).toContain('vol(s)');
  });

  it('costEstimate with zero volumes reports $0', () => {
    const noVols = new Ec2Instance({
      instanceId: 'i-nov', region, accountId: '123456789012', instanceType: 't3.micro',
      state: 'stopped', launchTime: new Date(), detectedAt: new Date(), attachedVolumes: [], tags: {}, monthlyCostUsd: 0, wasteReason: '',
    });
    expect(noVols.costEstimate.monthlyCostUsd).toBe(0);
  });

  it('exposes the remaining props', () => {
    const stoppedSince = new Date('2026-05-01');
    expect(stoppedInstance.region).toBe(region);
    expect(stoppedInstance.accountId).toBe('123456789012');
    expect(stoppedInstance.launchTime).toEqual(new Date('2024-01-01'));
    expect(stoppedInstance.detectedAt).toEqual(new Date('2026-06-09'));
    expect(stoppedInstance.tags).toEqual({ Env: 'dev' });
    expect(stoppedInstance.wasteReason).toContain('still billed');
    const withStoppedSince = new Ec2Instance({
      instanceId: 'i-ss', region, accountId: '123456789012', instanceType: 't3.micro',
      state: 'stopped', launchTime: new Date(), detectedAt: new Date(), stoppedSince, attachedVolumes: [], tags: {}, monthlyCostUsd: 0, wasteReason: '',
    });
    expect(withStoppedSince.stoppedSince).toBe(stoppedSince);
  });
});
