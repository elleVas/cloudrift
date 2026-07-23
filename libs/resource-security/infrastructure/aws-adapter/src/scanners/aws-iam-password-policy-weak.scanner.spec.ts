// SPDX-License-Identifier: Apache-2.0
import { IAMClient } from '@aws-sdk/client-iam';
import { AwsIamPasswordPolicyWeakScanner } from './aws-iam-password-policy-weak.scanner';
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
const scanner = new AwsIamPasswordPolicyWeakScanner();

const strongPolicy = {
  MinimumPasswordLength: 14,
  RequireSymbols: true,
  RequireNumbers: true,
  RequireUppercaseCharacters: true,
  RequireLowercaseCharacters: true,
  MaxPasswordAge: 90,
  PasswordReusePrevention: 24,
};

describe('AwsIamPasswordPolicyWeakScanner', () => {
  it('exposes its resource kind and global scope', () => {
    expect(scanner.kind).toBe('iam-password-policy-weak');
    expect(scanner.scope).toBe('global');
  });

  it('flags when no password policy exists', async () => {
    mockSend.mockRejectedValueOnce(Object.assign(new Error('no policy'), { name: 'NoSuchEntityException' }));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('flags a policy weaker than the CIS baseline', async () => {
    mockSend.mockResolvedValueOnce({ PasswordPolicy: { ...strongPolicy, MinimumPasswordLength: 8 } });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not flag a policy meeting the CIS baseline', async () => {
    mockSend.mockResolvedValueOnce({ PasswordPolicy: strongPolicy });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('returns Result.fail on an unexpected SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('Throttled'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
