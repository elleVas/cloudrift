// SPDX-License-Identifier: Apache-2.0
import { SageMakerEndpointIdle } from './sagemaker-endpoint-idle.entity';
import type { SageMakerEndpointIdleProps } from './sagemaker-endpoint-idle.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeEndpoint(overrides: Partial<SageMakerEndpointIdleProps> = {}): SageMakerEndpointIdle {
  return new SageMakerEndpointIdle({
    endpointName: 'my-endpoint',
    region,
    accountId: '123456789012',
    endpointConfigName: 'my-endpoint-config',
    instanceType: 'ml.m5.xlarge',
    instanceCount: 1,
    status: 'InService',
    invocationsLastWindow: 0,
    windowHours: 336,
    creationTime: new Date('2026-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 230,
    ...overrides,
  });
}

describe('SageMakerEndpointIdle', () => {
  it('exposes correct id and fields', () => {
    const endpoint = makeEndpoint();
    expect(endpoint.id).toBe('my-endpoint');
    expect(endpoint.endpointConfigName).toBe('my-endpoint-config');
  });

  it('exposes kind', () => {
    expect(makeEndpoint().kind).toBe('sagemaker-endpoint-idle');
  });

  it('wasteReason describes status, window and instance shape', () => {
    const endpoint = makeEndpoint({
      status: 'InService',
      windowHours: 336,
      instanceCount: 2,
      instanceType: 'ml.m5.xlarge',
    });
    expect(endpoint.wasteReason).toBe('InService, zero invocations over 336h — 2x ml.m5.xlarge');
  });

  it('costEstimate returns the fixed monthly cost', () => {
    expect(makeEndpoint({ monthlyCostUsd: 230 }).costEstimate.monthlyCostUsd).toBe(230);
  });

  it('costEstimate description references the instance type', () => {
    expect(makeEndpoint({ instanceType: 'ml.c5.2xlarge' }).costEstimate.description).toContain('ml.c5.2xlarge');
  });

  it('exposes the remaining props', () => {
    const creationTime = new Date('2025-01-01');
    const detectedAt = new Date('2026-06-09');
    const endpoint = makeEndpoint({
      region,
      accountId: '999999999999',
      instanceType: 'ml.c5.2xlarge',
      instanceCount: 3,
      status: 'Failed',
      invocationsLastWindow: 0,
      windowHours: 72,
      creationTime,
      detectedAt,
      tags: { env: 'prod' },
    });
    expect(endpoint.region).toBe(region);
    expect(endpoint.accountId).toBe('999999999999');
    expect(endpoint.instanceType).toBe('ml.c5.2xlarge');
    expect(endpoint.instanceCount).toBe(3);
    expect(endpoint.status).toBe('Failed');
    expect(endpoint.invocationsLastWindow).toBe(0);
    expect(endpoint.windowHours).toBe(72);
    expect(endpoint.creationTime).toBe(creationTime);
    expect(endpoint.detectedAt).toBe(detectedAt);
    expect(endpoint.tags).toEqual({ env: 'prod' });
  });
});
