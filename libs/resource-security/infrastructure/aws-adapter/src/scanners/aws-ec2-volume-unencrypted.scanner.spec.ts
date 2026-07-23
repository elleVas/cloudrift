// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeVolumesCommand } from '@aws-sdk/client-ec2';
import { AwsEc2VolumeUnencryptedScanner } from './aws-ec2-volume-unencrypted.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-ec2');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (EC2Client as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsEc2VolumeUnencryptedScanner();

describe('AwsEc2VolumeUnencryptedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('ec2-volume-unencrypted');
  });

  it('flags an unencrypted volume', async () => {
    mockSend.mockResolvedValueOnce({ Volumes: [{ VolumeId: 'vol-1', Encrypted: false }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((f) => f.id)).toEqual(['vol-1']);
  });

  it('does not flag an encrypted volume', async () => {
    mockSend.mockResolvedValueOnce({ Volumes: [{ VolumeId: 'vol-2', Encrypted: true }] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeVolumesCommand', async () => {
    mockSend.mockResolvedValueOnce({ Volumes: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeVolumesCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
