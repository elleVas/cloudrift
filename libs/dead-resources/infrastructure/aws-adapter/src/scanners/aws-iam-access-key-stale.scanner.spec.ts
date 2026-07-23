// SPDX-License-Identifier: Apache-2.0
import { IAMClient, ListUsersCommand } from '@aws-sdk/client-iam';
import { AwsIamAccessKeyStaleScanner } from './aws-iam-access-key-stale.scanner';
import { AwsRegion } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-iam');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (IAMClient as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsIamAccessKeyStaleScanner();
const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

/** ListUsers -> (per user) ListAccessKeys, in that call order. */
function queueUser(user: unknown, accessKeys: unknown[]): void {
  mockSend.mockResolvedValueOnce({ Users: [user] }).mockResolvedValueOnce({ AccessKeyMetadata: accessKeys });
}

describe('AwsIamAccessKeyStaleScanner', () => {
  it('exposes its resource kind and global scope', () => {
    expect(scanner.kind).toBe('iam-access-key-stale');
    expect(scanner.scope).toBe('global');
  });

  it('flags an old active access key', async () => {
    queueUser({ UserName: 'user-1' }, [{ AccessKeyId: 'AKIA1', Status: 'Active', CreateDate: oldDate }]);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((k) => k.id)).toEqual(['AKIA1']);
  });

  it('does not flag a recently created access key', async () => {
    queueUser({ UserName: 'user-2' }, [{ AccessKeyId: 'AKIA2', Status: 'Active', CreateDate: new Date() }]);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag an old but inactive access key', async () => {
    queueUser({ UserName: 'user-3' }, [{ AccessKeyId: 'AKIA3', Status: 'Inactive', CreateDate: oldDate }]);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListUsersCommand', async () => {
    mockSend.mockResolvedValueOnce({ Users: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListUsersCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
