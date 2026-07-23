// SPDX-License-Identifier: Apache-2.0
import { AwsRegion } from 'cloud-cost-domain';
import { CloudformationStackStuck } from './cloudformation-stack-stuck.entity';
import type { CloudformationStackStuckProps } from './cloudformation-stack-stuck.entity';

function makeStack(overrides: Partial<CloudformationStackStuckProps> = {}): CloudformationStackStuck {
  return new CloudformationStackStuck({
    stackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/broken-stack/abc-123',
    stackName: 'broken-stack',
    status: 'DELETE_FAILED',
    region: AwsRegion.create('us-east-1'),
    accountId: '123456789012',
    createdAt: new Date('2023-01-01'),
    detectedAt: new Date('2026-07-23'),
    tags: {},
    ...overrides,
  });
}

describe('CloudformationStackStuck', () => {
  it('exposes correct id and fields', () => {
    const stack = makeStack();
    expect(stack.id).toBe('arn:aws:cloudformation:us-east-1:123456789012:stack/broken-stack/abc-123');
    expect(stack.stackName).toBe('broken-stack');
    expect(stack.status).toBe('DELETE_FAILED');
  });

  it('exposes kind, hygieneReason and severity as critical', () => {
    const stack = makeStack();
    expect(stack.kind).toBe('cloudformation-stack-stuck');
    expect(stack.hygieneReason).toBe('stuck in DELETE_FAILED');
    expect(stack.severity).toBe('critical');
  });
});
