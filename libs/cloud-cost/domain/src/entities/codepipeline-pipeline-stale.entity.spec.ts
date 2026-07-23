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
    expect(makePipeline().wasteReason).toContain('grace period');
  });

  it('costEstimate reflects the flat monthly price', () => {
    expect(makePipeline().costEstimate.monthlyCostUsd).toBe(1);
  });
});
