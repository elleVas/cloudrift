// SPDX-License-Identifier: Apache-2.0
import { CloudTrailClient, DescribeTrailsCommand } from '@aws-sdk/client-cloudtrail';
import { AwsCloudtrailNotMultiregionScanner } from './aws-cloudtrail-not-multiregion.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-cloudtrail');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (CloudTrailClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsCloudtrailNotMultiregionScanner();

describe('AwsCloudtrailNotMultiregionScanner', () => {
  it('exposes its resource kind and global scope', () => {
    expect(scanner.kind).toBe('cloudtrail-not-multiregion');
    expect(scanner.scope).toBe('global');
  });

  it('flags an account with no multi-region trail', async () => {
    mockSend.mockResolvedValueOnce({ trailList: [{ Name: 'regional-trail', IsMultiRegionTrail: false }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not flag an account with a multi-region trail', async () => {
    mockSend.mockResolvedValueOnce({ trailList: [{ Name: 'org-trail', IsMultiRegionTrail: true }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeTrailsCommand', async () => {
    mockSend.mockResolvedValueOnce({ trailList: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeTrailsCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
