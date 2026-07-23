// SPDX-License-Identifier: Apache-2.0
import { IAMClient, ListUsersCommand, ListMFADevicesCommand } from '@aws-sdk/client-iam';
import { AwsIamUserMfaDisabledScanner } from './aws-iam-user-mfa-disabled.scanner';
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
const scanner = new AwsIamUserMfaDisabledScanner();
const createdAt = new Date('2024-01-01');

function makeUser(userName: string) {
  return { UserName: userName, Arn: `arn:aws:iam::123:user/${userName}`, CreateDate: createdAt };
}

describe('AwsIamUserMfaDisabledScanner', () => {
  it('exposes its resource kind and global scope', () => {
    expect(scanner.kind).toBe('iam-user-mfa-disabled');
    expect(scanner.scope).toBe('global');
  });

  it('flags a user with no MFA device', async () => {
    mockSend.mockImplementation((command: unknown) => {
      if (command instanceof ListUsersCommand) return Promise.resolve({ Users: [makeUser('alice')] });
      if (command instanceof ListMFADevicesCommand) return Promise.resolve({ MFADevices: [] });
      throw new Error('unexpected command');
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((f) => f.id)).toEqual(['arn:aws:iam::123:user/alice']);
  });

  it('does not flag a user with an MFA device registered', async () => {
    mockSend.mockImplementation((command: unknown) => {
      if (command instanceof ListUsersCommand) return Promise.resolve({ Users: [makeUser('alice')] });
      if (command instanceof ListMFADevicesCommand) return Promise.resolve({ MFADevices: [{ SerialNumber: 'mfa-1' }] });
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
