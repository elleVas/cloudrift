// SPDX-License-Identifier: Apache-2.0
import { KMSClient, ListKeysCommand, DescribeKeyCommand, GetKeyRotationStatusCommand } from '@aws-sdk/client-kms';
import { AwsKmsKeyRotationDisabledScanner } from './aws-kms-key-rotation-disabled.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from 'shared-aws-infra-utils';

jest.mock('@aws-sdk/client-kms');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (KMSClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsKmsKeyRotationDisabledScanner();

describe('AwsKmsKeyRotationDisabledScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('kms-key-rotation-disabled');
  });

  it('flags a customer-managed symmetric key with rotation disabled', async () => {
    mockSend
      .mockResolvedValueOnce({ Keys: [{ KeyId: 'key-1' }] })
      .mockResolvedValueOnce({ KeyMetadata: { KeyManager: 'CUSTOMER', KeySpec: 'SYMMETRIC_DEFAULT' } })
      .mockResolvedValueOnce({ KeyRotationEnabled: false });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not flag a key with rotation enabled', async () => {
    mockSend
      .mockResolvedValueOnce({ Keys: [{ KeyId: 'key-1' }] })
      .mockResolvedValueOnce({ KeyMetadata: { KeyManager: 'CUSTOMER', KeySpec: 'SYMMETRIC_DEFAULT' } })
      .mockResolvedValueOnce({ KeyRotationEnabled: true });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips AWS-managed keys without calling GetKeyRotationStatus', async () => {
    mockSend.mockResolvedValueOnce({ Keys: [{ KeyId: 'key-1' }] }).mockResolvedValueOnce({ KeyMetadata: { KeyManager: 'AWS', KeySpec: 'SYMMETRIC_DEFAULT' } });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
    expect(mockSend).not.toHaveBeenCalledWith(expect.any(GetKeyRotationStatusCommand));
  });

  it('skips a key after a per-key error instead of failing the whole scan', async () => {
    mockSend.mockResolvedValueOnce({ Keys: [{ KeyId: 'key-1' }] }).mockRejectedValueOnce(new Error('AccessDeniedException'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListKeysCommand and DescribeKeyCommand', async () => {
    mockSend.mockResolvedValueOnce({ Keys: [{ KeyId: 'key-1' }] }).mockResolvedValueOnce({ KeyMetadata: { KeyManager: 'AWS' } });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListKeysCommand));
    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeKeyCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError when ListKeys itself fails, and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
