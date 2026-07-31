// SPDX-License-Identifier: Apache-2.0
import { ECRClient, DescribeRepositoriesCommand, GetRepositoryPolicyCommand } from '@aws-sdk/client-ecr';
import { AwsEcrRepositoryPolicyPublicScanner } from './aws-ecr-repository-policy-public.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from 'shared-aws-infra-utils';

jest.mock('@aws-sdk/client-ecr');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (ECRClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsEcrRepositoryPolicyPublicScanner();
const repo = { repositoryName: 'my-repo', repositoryArn: 'arn:aws:ecr:us-east-1:123456789012:repository/my-repo' };

const publicPolicy = JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: '*', Action: 'ecr:GetDownloadUrlForLayer' }] });
const scopedPolicy = JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::123456789012:root' }, Action: 'ecr:GetDownloadUrlForLayer' }] });

describe('AwsEcrRepositoryPolicyPublicScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('ecr-repository-policy-public');
  });

  it('flags a repository with a public repository policy', async () => {
    mockSend.mockResolvedValueOnce({ repositories: [repo] }).mockResolvedValueOnce({ policyText: publicPolicy });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not flag a repository with a scoped policy', async () => {
    mockSend.mockResolvedValueOnce({ repositories: [repo] }).mockResolvedValueOnce({ policyText: scopedPolicy });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag a repository with no policy at all', async () => {
    const err = new Error('policy not found');
    err.name = 'RepositoryPolicyNotFoundException';
    mockSend.mockResolvedValueOnce({ repositories: [repo] }).mockRejectedValueOnce(err);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeRepositoriesCommand and GetRepositoryPolicyCommand', async () => {
    mockSend.mockResolvedValueOnce({ repositories: [repo] }).mockResolvedValueOnce({ policyText: scopedPolicy });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeRepositoriesCommand));
    expect(mockSend).toHaveBeenCalledWith(expect.any(GetRepositoryPolicyCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError when DescribeRepositories itself fails, and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
