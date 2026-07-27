// SPDX-License-Identifier: Apache-2.0
import { SageMakerTrainingOrphaned } from './sagemaker-training-orphaned.entity';
import type { SageMakerTrainingOrphanedProps } from './sagemaker-training-orphaned.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeModel(overrides: Partial<SageMakerTrainingOrphanedProps> = {}): SageMakerTrainingOrphaned {
  return new SageMakerTrainingOrphaned({
    modelName: 'my-model',
    region,
    accountId: '123456789012',
    modelArn: 'arn:aws:sagemaker:us-east-1:123456789012:model/my-model',
    primaryContainerImage: '123456789012.dkr.ecr.us-east-1.amazonaws.com/my-image:latest',
    modelDataUrl: 's3://my-bucket/my-model/model.tar.gz',
    referencedByEndpointConfig: false,
    creationTime: new Date('2026-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 0.5,
    ...overrides,
  });
}

describe('SageMakerTrainingOrphaned', () => {
  it('exposes correct id and fields', () => {
    const model = makeModel();
    expect(model.id).toBe('my-model');
    expect(model.modelArn).toBe('arn:aws:sagemaker:us-east-1:123456789012:model/my-model');
  });

  it('exposes kind', () => {
    expect(makeModel().kind).toBe('sagemaker-training-orphaned');
  });

  it('wasteReason references the creation date and lack of endpoint config', () => {
    const model = makeModel({ creationTime: new Date('2026-03-15T12:00:00Z') });
    expect(model.wasteReason).toBe('model created 2026-03-15, not referenced by any endpoint config');
  });

  it('costEstimate returns the estimated S3 storage cost passed in, not a hardcoded value', () => {
    expect(makeModel({ monthlyCostUsd: 0.5 }).costEstimate.monthlyCostUsd).toBe(0.5);
    expect(makeModel({ monthlyCostUsd: 2.1 }).costEstimate.monthlyCostUsd).toBe(2.1);
  });

  it('costEstimate description references the model name and the S3 storage estimate caveat', () => {
    const description = makeModel({ modelName: 'my-model' }).costEstimate.description;
    expect(description).toContain('my-model');
    expect(description).toContain('estimated S3 storage cost');
  });

  it('exposes the remaining props', () => {
    const creationTime = new Date('2025-01-01');
    const detectedAt = new Date('2026-06-09');
    const model = makeModel({
      region,
      accountId: '999999999999',
      primaryContainerImage: '999999999999.dkr.ecr.us-east-1.amazonaws.com/other-image:v2',
      modelDataUrl: 's3://other-bucket/other-model/model.tar.gz',
      referencedByEndpointConfig: false,
      creationTime,
      detectedAt,
      tags: { env: 'prod' },
    });
    expect(model.region).toBe(region);
    expect(model.accountId).toBe('999999999999');
    expect(model.primaryContainerImage).toBe('999999999999.dkr.ecr.us-east-1.amazonaws.com/other-image:v2');
    expect(model.modelDataUrl).toBe('s3://other-bucket/other-model/model.tar.gz');
    expect(model.referencedByEndpointConfig).toBe(false);
    expect(model.creationTime).toBe(creationTime);
    expect(model.detectedAt).toBe(detectedAt);
    expect(model.tags).toEqual({ env: 'prod' });
  });
});
