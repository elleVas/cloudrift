// SPDX-License-Identifier: Apache-2.0
import { IAMClient, ListUsersCommand } from '@aws-sdk/client-iam';
import { AwsIamUserPolicyWildcardScanner } from './aws-iam-user-policy-wildcard.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from 'shared-aws-infra-utils';

jest.mock('@aws-sdk/client-iam');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (IAMClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsIamUserPolicyWildcardScanner();

const wildcardDoc = encodeURIComponent(JSON.stringify({ Statement: [{ Effect: 'Allow', Action: '*', Resource: '*' }] }));
const scopedDoc = encodeURIComponent(JSON.stringify({ Statement: [{ Effect: 'Allow', Action: 's3:GetObject', Resource: 'arn:aws:s3:::my-bucket/*' }] }));

describe('AwsIamUserPolicyWildcardScanner', () => {
  it('exposes its resource kind and global scope', () => {
    expect(scanner.kind).toBe('iam-user-policy-wildcard');
    expect(scanner.scope).toBe('global');
  });

  it('flags a user with a wildcard-admin managed policy', async () => {
    mockSend
      .mockResolvedValueOnce({ Users: [{ UserName: 'alice', Arn: 'arn:aws:iam::123456789012:user/alice' }] }) // ListUsers
      .mockResolvedValueOnce({ AttachedPolicies: [{ PolicyName: 'AdminAccess', PolicyArn: 'arn:aws:iam::aws:policy/AdminAccess' }] }) // ListAttachedUserPolicies
      .mockResolvedValueOnce({ Policy: { DefaultVersionId: 'v1' } }) // GetPolicy
      .mockResolvedValueOnce({ PolicyVersion: { Document: wildcardDoc } }); // GetPolicyVersion

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect((result.value[0] as { policyName: string }).policyName).toBe('AdminAccess');
    }
  });

  it('flags a user with a wildcard-admin inline policy, after managed policies come back clean', async () => {
    mockSend
      .mockResolvedValueOnce({ Users: [{ UserName: 'alice', Arn: 'arn:aws:iam::123456789012:user/alice' }] }) // ListUsers
      .mockResolvedValueOnce({ AttachedPolicies: [] }) // ListAttachedUserPolicies
      .mockResolvedValueOnce({ PolicyNames: ['InlineAdmin'] }) // ListUserPolicies
      .mockResolvedValueOnce({ PolicyDocument: wildcardDoc }); // GetUserPolicy

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(1);
      expect((result.value[0] as { policyName: string }).policyName).toBe('InlineAdmin');
    }
  });

  it('does not flag a user whose policies are all scoped', async () => {
    mockSend
      .mockResolvedValueOnce({ Users: [{ UserName: 'alice', Arn: 'arn:aws:iam::123456789012:user/alice' }] })
      .mockResolvedValueOnce({ AttachedPolicies: [{ PolicyName: 'ReadOnly', PolicyArn: 'arn:aws:iam::aws:policy/ReadOnly' }] })
      .mockResolvedValueOnce({ Policy: { DefaultVersionId: 'v1' } })
      .mockResolvedValueOnce({ PolicyVersion: { Document: scopedDoc } })
      .mockResolvedValueOnce({ PolicyNames: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips a user after a per-user error instead of failing the whole scan', async () => {
    mockSend.mockResolvedValueOnce({ Users: [{ UserName: 'alice', Arn: 'arn:aws:iam::123456789012:user/alice' }] }).mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListUsersCommand', async () => {
    mockSend.mockResolvedValueOnce({ Users: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListUsersCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError when ListUsers itself fails, and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
