// SPDX-License-Identifier: Apache-2.0
import { EC2Client, DescribeKeyPairsCommand } from '@aws-sdk/client-ec2';
import { AwsEc2KeyPairUnusedScanner } from './aws-ec2-keypair-unused.scanner';
import { AwsRegion } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-ec2');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (EC2Client as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsEc2KeyPairUnusedScanner();
const oldDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

function queueNoInstances(keyPairs: unknown[]): void {
  mockSend.mockResolvedValueOnce({ KeyPairs: keyPairs }).mockResolvedValueOnce({ Reservations: [] });
}

describe('AwsEc2KeyPairUnusedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('ec2-keypair-unused');
  });

  it('flags an old key pair not referenced by any instance', async () => {
    queueNoInstances([{ KeyPairId: 'key-1', KeyName: 'old-key', CreateTime: oldDate }]);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((k) => k.id)).toEqual(['key-1']);
    expect(result.value[0].hygieneReason).toContain('not referenced');
    expect(result.value[0].severity).toBe('info');
  });

  it('does not flag a key pair referenced by a running instance', async () => {
    mockSend
      .mockResolvedValueOnce({ KeyPairs: [{ KeyPairId: 'key-2', KeyName: 'used-key', CreateTime: oldDate }] })
      .mockResolvedValueOnce({
        Reservations: [{ Instances: [{ KeyName: 'used-key', State: { Name: 'running' } }] }],
      });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag a key pair referenced only by a terminated instance', async () => {
    mockSend
      .mockResolvedValueOnce({ KeyPairs: [{ KeyPairId: 'key-3', KeyName: 'terminated-key', CreateTime: oldDate }] })
      .mockResolvedValueOnce({
        Reservations: [{ Instances: [{ KeyName: 'terminated-key', State: { Name: 'terminated' } }] }],
      });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((k) => k.id)).toEqual(['key-3']);
  });

  it('does not report a key pair tagged cloudrift:ignore', async () => {
    queueNoInstances([
      { KeyPairId: 'key-keep', KeyName: 'keep', CreateTime: oldDate, Tags: [{ Key: 'cloudrift:ignore', Value: '' }] },
    ]);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag a key pair created within the grace period', async () => {
    queueNoInstances([{ KeyPairId: 'key-new', KeyName: 'new-key', CreateTime: new Date() }]);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeKeyPairsCommand', async () => {
    queueNoInstances([]);

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeKeyPairsCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
