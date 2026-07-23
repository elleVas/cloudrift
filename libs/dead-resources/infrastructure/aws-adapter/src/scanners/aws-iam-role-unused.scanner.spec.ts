// SPDX-License-Identifier: Apache-2.0
import { IAMClient, ListRolesCommand } from '@aws-sdk/client-iam';
import { AwsIamRoleUnusedScanner } from './aws-iam-role-unused.scanner';
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
const scanner = new AwsIamRoleUnusedScanner();
const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

describe('AwsIamRoleUnusedScanner', () => {
  it('exposes its resource kind and global scope', () => {
    expect(scanner.kind).toBe('iam-role-unused');
    expect(scanner.scope).toBe('global');
  });

  it('flags a role never assumed', async () => {
    mockSend.mockResolvedValueOnce({
      Roles: [{ RoleId: 'AROA1', RoleName: 'old-role', Arn: 'arn:aws:iam::123:role/old-role', CreateDate: oldDate, Path: '/' }],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((r) => r.id)).toEqual(['AROA1']);
  });

  it('does not flag a role assumed recently', async () => {
    mockSend.mockResolvedValueOnce({
      Roles: [
        {
          RoleId: 'AROA2',
          RoleName: 'active-role',
          Arn: 'arn:aws:iam::123:role/active-role',
          CreateDate: oldDate,
          Path: '/',
          RoleLastUsed: { LastUsedDate: new Date() },
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('excludes service-linked roles', async () => {
    mockSend.mockResolvedValueOnce({
      Roles: [
        {
          RoleId: 'AROA3',
          RoleName: 'AWSServiceRoleForSomething',
          Arn: 'arn:aws:iam::123:role/aws-service-role/something.amazonaws.com/AWSServiceRoleForSomething',
          CreateDate: oldDate,
          Path: '/aws-service-role/something.amazonaws.com/',
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not report a role tagged cloudrift:ignore', async () => {
    mockSend.mockResolvedValueOnce({
      Roles: [
        {
          RoleId: 'AROA4',
          RoleName: 'keep-role',
          Arn: 'arn:aws:iam::123:role/keep-role',
          CreateDate: oldDate,
          Path: '/',
          Tags: [{ Key: 'cloudrift:ignore', Value: '' }],
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListRolesCommand', async () => {
    mockSend.mockResolvedValueOnce({ Roles: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListRolesCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
