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
      state: 'running', launchTime: new Date(), detectedAt: new Date(), attachedVolumes: [], tags: {}, monthlyCostUsd: 0,
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
      state: 'stopped', launchTime: new Date(), detectedAt: new Date(), attachedVolumes: [], tags: {}, monthlyCostUsd: 0,
    });
    expect(noVols.costEstimate.monthlyCostUsd).toBe(0);
  });
});
