// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { StepfunctionsStatemachineUnused } from './stepfunctions-statemachine-unused.entity';
import type { StepfunctionsStatemachineUnusedProps } from './stepfunctions-statemachine-unused.entity';

function makeMachine(overrides: Partial<StepfunctionsStatemachineUnusedProps> = {}): StepfunctionsStatemachineUnused {
  return new StepfunctionsStatemachineUnused({
    stateMachineArn: 'arn:aws:states:us-east-1:123456789012:stateMachine:old-workflow',
    name: 'old-workflow',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    createdAt: new Date('2023-01-01'),
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('StepfunctionsStatemachineUnused', () => {
  it('exposes correct id and fields', () => {
    const machine = makeMachine();
    expect(machine.id).toBe('arn:aws:states:us-east-1:123456789012:stateMachine:old-workflow');
    expect(machine.name).toBe('old-workflow');
  });

  it('exposes kind, hygieneReason and severity', () => {
    const machine = makeMachine();
    expect(machine.kind).toBe('stepfunctions-statemachine-unused');
    expect(machine.hygieneReason).toContain('never been executed');
    expect(machine.severity).toBe('info');
  });

  it('exposes the remaining props', () => {
    const region = AwsRegion.create('eu-west-1');
    const createdAt = new Date('2022-01-01');
    const detectedAt = new Date('2026-07-23');
    const machine = makeMachine({ region, accountId: '999999999999', createdAt, detectedAt, tags: {} });
    expect(machine.region).toBe(region);
    expect(machine.accountId).toBe('999999999999');
    expect(machine.createdAt).toBe(createdAt);
    expect(machine.detectedAt).toBe(detectedAt);
    expect(machine.tags).toEqual({});
  });
});
