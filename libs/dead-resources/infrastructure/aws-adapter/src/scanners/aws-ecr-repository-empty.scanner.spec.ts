// SPDX-License-Identifier: Apache-2.0
import { ECRClient, DescribeRepositoriesCommand } from '@aws-sdk/client-ecr';
import { AwsEcrRepositoryEmptyScanner } from './aws-ecr-repository-empty.scanner';
import { AwsRegion } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

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
const scanner = new AwsEcrRepositoryEmptyScanner();
const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

/** DescribeRepositories -> (per repo) DescribeImages, in that call order. */
function queueRepo(repo: unknown, imageDetails: unknown[]): void {
  mockSend.mockResolvedValueOnce({ repositories: [repo] }).mockResolvedValueOnce({ imageDetails });
}

describe('AwsEcrRepositoryEmptyScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('ecr-repository-empty');
  });

  it('flags an old repository with zero images', async () => {
    queueRepo({ repositoryArn: 'arn:aws:ecr:us-east-1:123:repository/empty-repo', repositoryName: 'empty-repo', createdAt: oldDate }, []);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((r) => r.id)).toEqual(['arn:aws:ecr:us-east-1:123:repository/empty-repo']);
  });

  it('does not flag a repository with at least one image', async () => {
    queueRepo({ repositoryArn: 'arn:aws:ecr:us-east-1:123:repository/used-repo', repositoryName: 'used-repo', createdAt: oldDate }, [{ imageDigest: 'sha256:abc' }]);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag a repository created within the grace period', async () => {
    queueRepo({ repositoryArn: 'arn:aws:ecr:us-east-1:123:repository/new-repo', repositoryName: 'new-repo', createdAt: new Date() }, []);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips a repository it cannot inspect instead of failing the whole scan', async () => {
    mockSend
      .mockResolvedValueOnce({ repositories: [{ repositoryArn: 'arn:aws:ecr:us-east-1:123:repository/forbidden', repositoryName: 'forbidden', createdAt: oldDate }] })
      .mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeRepositoriesCommand', async () => {
    mockSend.mockResolvedValueOnce({ repositories: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeRepositoriesCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError when DescribeRepositories itself fails', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
