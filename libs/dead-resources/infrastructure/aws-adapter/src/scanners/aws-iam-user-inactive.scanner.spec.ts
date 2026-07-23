// SPDX-License-Identifier: Apache-2.0
import { IAMClient, ListUsersCommand } from '@aws-sdk/client-iam';
import { AwsIamUserInactiveScanner } from './aws-iam-user-inactive.scanner';
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
const scanner = new AwsIamUserInactiveScanner();
const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

/** ListUsers -> (per user) ListAccessKeys -> (per key) GetAccessKeyLastUsed, in that call order. */
function queueUser(user: unknown, accessKeys: unknown[], lastUsedByKey: Array<{ LastUsedDate?: Date }>): void {
  mockSend.mockResolvedValueOnce({ Users: [user] }).mockResolvedValueOnce({ AccessKeyMetadata: accessKeys });
  for (const lastUsed of lastUsedByKey) {
    mockSend.mockResolvedValueOnce({ AccessKeyLastUsed: lastUsed });
  }
}

describe('AwsIamUserInactiveScanner', () => {
  it('exposes its resource kind and global scope', () => {
    expect(scanner.kind).toBe('iam-user-inactive');
    expect(scanner.scope).toBe('global');
  });

  it('flags a user with no password login and no access keys', async () => {
    queueUser(
      { UserId: 'AIDA1', UserName: 'dead-user', Arn: 'arn:aws:iam::123:user/dead-user', CreateDate: oldDate },
      [],
      [],
    );

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((u) => u.id)).toEqual(['AIDA1']);
  });

  it('does not flag a user with a recent access-key usage', async () => {
    const recent = new Date();
    queueUser(
      { UserId: 'AIDA2', UserName: 'active-user', Arn: 'arn:aws:iam::123:user/active-user', CreateDate: oldDate },
      [{ AccessKeyId: 'AKIA123' }],
      [{ LastUsedDate: recent }],
    );

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag a user with a recent password login even with no access keys', async () => {
    queueUser(
      {
        UserId: 'AIDA3',
        UserName: 'console-user',
        Arn: 'arn:aws:iam::123:user/console-user',
        CreateDate: oldDate,
        PasswordLastUsed: new Date(),
      },
      [],
      [],
    );

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a user tagged cloudrift:ignore', async () => {
    queueUser(
      {
        UserId: 'AIDA4',
        UserName: 'keep-user',
        Arn: 'arn:aws:iam::123:user/keep-user',
        CreateDate: oldDate,
        Tags: [{ Key: 'cloudrift:ignore', Value: '' }],
      },
      [],
      [],
    );

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
