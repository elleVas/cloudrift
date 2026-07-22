// SPDX-License-Identifier: Apache-2.0
import { EcrImageUntagged } from './ecr-image-untagged.entity';
import type { EcrImageUntaggedProps } from './ecr-image-untagged.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeImage(overrides: Partial<EcrImageUntaggedProps> = {}): EcrImageUntagged {
  return new EcrImageUntagged({
    imageDigest: 'sha256:abc123',
    region,
    accountId: '123456789012',
    repositoryName: 'my-repo',
    sizeBytes: 2 * 1024 ** 3,
    imagePushedAt: new Date('2026-01-01'),
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 0.2,
    ...overrides,
  });
}

describe('EcrImageUntagged', () => {
  it('exposes correct id and fields', () => {
    const img = makeImage();
    expect(img.id).toBe('sha256:abc123');
    expect(img.repositoryName).toBe('my-repo');
  });

  it('exposes kind and wasteReason', () => {
    expect(makeImage().kind).toBe('ecr-image-untagged');
    expect(makeImage().wasteReason).toContain('no image tag');
  });

  it('costEstimate description references the image size', () => {
    expect(makeImage().costEstimate.description).toContain('2.00 GB');
  });
});
