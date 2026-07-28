// SPDX-License-Identifier: Apache-2.0
import { CodepipelinePipelineStale } from './codepipeline-pipeline-stale.entity';
import type { CodepipelinePipelineStaleProps } from './codepipeline-pipeline-stale.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makePipeline(overrides: Partial<CodepipelinePipelineStaleProps> = {}): CodepipelinePipelineStale {
  return new CodepipelinePipelineStale({
    pipelineName: 'legacy-deploy-pipeline',
    region,
    accountId: '123456789012',
    createdAt: new Date('2024-01-15'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 1,
    wasteReason: 'never executed, created 876d ago',
    ...overrides,
  });
}

describe('CodepipelinePipelineStale', () => {
  it('exposes correct id and fields', () => {
    const pipeline = makePipeline();
    expect(pipeline.id).toBe('legacy-deploy-pipeline');
    expect(pipeline.pipelineName).toBe('legacy-deploy-pipeline');
    expect(pipeline.lastExecutionAt).toBeUndefined();
  });

  it('exposes kind and wasteReason', () => {
    expect(makePipeline().kind).toBe('codepipeline-pipeline-stale');
    expect(makePipeline().wasteReason).toContain('never executed');
  });

  it('costEstimate reflects the flat monthly price', () => {
    expect(makePipeline().costEstimate.monthlyCostUsd).toBe(1);
  });

  it('exposes the remaining props', () => {
    const createdAt = new Date('2023-01-01');
    const lastExecutionAt = new Date('2026-01-01');
    const detectedAt = new Date('2026-06-09');
    const pipeline = makePipeline({ region, accountId: '999999999999', createdAt, lastExecutionAt, detectedAt, tags: {} });
    expect(pipeline.region).toBe(region);
    expect(pipeline.accountId).toBe('999999999999');
    expect(pipeline.createdAt).toBe(createdAt);
    expect(pipeline.lastExecutionAt).toBe(lastExecutionAt);
    expect(pipeline.detectedAt).toBe(detectedAt);
    expect(pipeline.tags).toEqual({});
  });
});
