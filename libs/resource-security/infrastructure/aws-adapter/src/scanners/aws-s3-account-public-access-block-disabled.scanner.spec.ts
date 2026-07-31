// SPDX-License-Identifier: Apache-2.0
import { S3ControlClient, GetPublicAccessBlockCommand } from '@aws-sdk/client-s3-control';
import { AwsS3AccountPublicAccessBlockDisabledScanner } from './aws-s3-account-public-access-block-disabled.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from 'shared-aws-infra-utils';

jest.mock('@aws-sdk/client-s3-control');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (S3ControlClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsS3AccountPublicAccessBlockDisabledScanner('123456789012');

describe('AwsS3AccountPublicAccessBlockDisabledScanner', () => {
  it('exposes its resource kind and global scope', () => {
    expect(scanner.kind).toBe('s3-account-public-access-block-disabled');
    expect(scanner.scope).toBe('global');
  });

  it('flags an account with no configuration at all', async () => {
    const err = new Error('not found');
    err.name = 'NoSuchPublicAccessBlockConfiguration';
    mockSend.mockRejectedValueOnce(err);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('flags an account with a partially-enabled block', async () => {
    mockSend.mockResolvedValueOnce({ PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: false, RestrictPublicBuckets: true } });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not flag an account with the block fully enabled', async () => {
    mockSend.mockResolvedValueOnce({ PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends GetPublicAccessBlockCommand with the account ID', async () => {
    mockSend.mockResolvedValueOnce({ PublicAccessBlockConfiguration: { BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true } });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(GetPublicAccessBlockCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on an unrelated SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
