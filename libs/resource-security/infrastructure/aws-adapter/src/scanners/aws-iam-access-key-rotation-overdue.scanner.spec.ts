// SPDX-License-Identifier: Apache-2.0
import { IAMClient, ListUsersCommand, ListAccessKeysCommand } from '@aws-sdk/client-iam';
import { AwsIamAccessKeyRotationOverdueScanner } from './aws-iam-access-key-rotation-overdue.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-iam');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (IAMClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsIamAccessKeyRotationOverdueScanner();
const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);
const recentDate = new Date();

describe('AwsIamAccessKeyRotationOverdueScanner', () => {
  it('exposes its resource kind and global scope', () => {
    expect(scanner.kind).toBe('iam-access-key-rotation-overdue');
    expect(scanner.scope).toBe('global');
  });

  it('flags an active access key older than the rotation window', async () => {
    mockSend.mockImplementation((command: unknown) => {
      if (command instanceof ListUsersCommand) return Promise.resolve({ Users: [{ UserName: 'alice' }] });
      if (command instanceof ListAccessKeysCommand) {
        return Promise.resolve({
          AccessKeyMetadata: [{ AccessKeyId: 'AKIA1', UserName: 'alice', CreateDate: oldDate, Status: 'Active' }],
        });
      }
      throw new Error('unexpected command');
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((f) => f.id)).toEqual(['AKIA1']);
  });

  it('does not flag a recently created key', async () => {
    mockSend.mockImplementation((command: unknown) => {
      if (command instanceof ListUsersCommand) return Promise.resolve({ Users: [{ UserName: 'alice' }] });
      if (command instanceof ListAccessKeysCommand) {
        return Promise.resolve({
          AccessKeyMetadata: [{ AccessKeyId: 'AKIA2', UserName: 'alice', CreateDate: recentDate, Status: 'Active' }],
        });
      }
      throw new Error('unexpected command');
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag an inactive key', async () => {
    mockSend.mockImplementation((command: unknown) => {
      if (command instanceof ListUsersCommand) return Promise.resolve({ Users: [{ UserName: 'alice' }] });
      if (command instanceof ListAccessKeysCommand) {
        return Promise.resolve({
          AccessKeyMetadata: [{ AccessKeyId: 'AKIA3', UserName: 'alice', CreateDate: oldDate, Status: 'Inactive' }],
        });
      }
      throw new Error('unexpected command');
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
