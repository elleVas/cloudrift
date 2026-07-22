// SPDX-License-Identifier: Apache-2.0
import { ECRClient, DescribeRepositoriesCommand } from '@aws-sdk/client-ecr';
import { AwsEcrImageUntaggedScanner } from './aws-ecr-image-untagged.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

jest.mock('@aws-sdk/client-ecr');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (ECRClient as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsEcrImageUntaggedScanner(mockPricing);
const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

describe('AwsEcrImageUntaggedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('ecr-image-untagged');
  });

  it('returns only untagged images, sized and priced', async () => {
    mockSend
      .mockResolvedValueOnce({ repositories: [{ repositoryName: 'my-repo' }] })
      .mockResolvedValueOnce({
        imageDetails: [
          { imageDigest: 'sha256:untagged', imageSizeInBytes: 1024 ** 3, imagePushedAt: oldDate },
          { imageDigest: 'sha256:tagged', imageTags: ['latest'], imageSizeInBytes: 1024 ** 3, imagePushedAt: oldDate },
        ],
      });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((i) => i.id)).toEqual(['sha256:untagged']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(0.1, 2);
  });

  it('does not flag an image pushed less than the grace period ago', async () => {
    mockSend
      .mockResolvedValueOnce({ repositories: [{ repositoryName: 'my-repo' }] })
      .mockResolvedValueOnce({
        imageDetails: [{ imageDigest: 'sha256:fresh', imageSizeInBytes: 1024 ** 3, imagePushedAt: new Date() }],
      });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeRepositoriesCommand', async () => {
    mockSend.mockResolvedValueOnce({ repositories: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeRepositoriesCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
