// SPDX-License-Identifier: Apache-2.0
import { SageMakerNotebookIdle } from './sagemaker-notebook-idle.entity';
import type { SageMakerNotebookIdleProps } from './sagemaker-notebook-idle.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeNotebook(overrides: Partial<SageMakerNotebookIdleProps> = {}): SageMakerNotebookIdle {
  return new SageMakerNotebookIdle({
    notebookInstanceName: 'my-notebook',
    region,
    accountId: '123456789012',
    instanceType: 'ml.t3.medium',
    status: 'InService',
    maxCpuPercent: 1.5,
    windowHours: 336,
    lastModifiedTime: new Date('2026-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 45,
    ...overrides,
  });
}

describe('SageMakerNotebookIdle', () => {
  it('exposes correct id and fields', () => {
    const notebook = makeNotebook();
    expect(notebook.id).toBe('my-notebook');
    expect(notebook.instanceType).toBe('ml.t3.medium');
  });

  it('exposes kind', () => {
    expect(makeNotebook().kind).toBe('sagemaker-notebook-idle');
  });

  it('wasteReason describes status, max CPU and the CPU-only caveat', () => {
    const notebook = makeNotebook({ status: 'InService', maxCpuPercent: 3.14, windowHours: 336 });
    expect(notebook.wasteReason).toBe(
      'InService, max CPU 3.1% over 336h — checks CPU only, not Jupyter kernel activity',
    );
  });

  it('costEstimate returns the fixed monthly cost', () => {
    expect(makeNotebook({ monthlyCostUsd: 45 }).costEstimate.monthlyCostUsd).toBe(45);
  });

  it('costEstimate description references the instance type', () => {
    expect(makeNotebook({ instanceType: 'ml.p3.2xlarge' }).costEstimate.description).toContain('ml.p3.2xlarge');
  });

  it('exposes the remaining props', () => {
    const lastModifiedTime = new Date('2025-01-01');
    const detectedAt = new Date('2026-06-09');
    const notebook = makeNotebook({
      region,
      accountId: '999999999999',
      instanceType: 'ml.p3.2xlarge',
      status: 'Stopped',
      maxCpuPercent: 0,
      windowHours: 72,
      lastModifiedTime,
      detectedAt,
      tags: { env: 'prod' },
    });
    expect(notebook.region).toBe(region);
    expect(notebook.accountId).toBe('999999999999');
    expect(notebook.instanceType).toBe('ml.p3.2xlarge');
    expect(notebook.status).toBe('Stopped');
    expect(notebook.maxCpuPercent).toBe(0);
    expect(notebook.windowHours).toBe(72);
    expect(notebook.lastModifiedTime).toBe(lastModifiedTime);
    expect(notebook.detectedAt).toBe(detectedAt);
    expect(notebook.tags).toEqual({ env: 'prod' });
  });
});
