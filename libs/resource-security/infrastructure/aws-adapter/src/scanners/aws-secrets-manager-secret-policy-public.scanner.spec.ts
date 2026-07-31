// SPDX-License-Identifier: Apache-2.0
import { SecretsManagerClient, ListSecretsCommand, GetResourcePolicyCommand } from '@aws-sdk/client-secrets-manager';
import { AwsSecretsManagerSecretPolicyPublicScanner } from './aws-secrets-manager-secret-policy-public.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from 'shared-aws-infra-utils';

jest.mock('@aws-sdk/client-secrets-manager');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (SecretsManagerClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsSecretsManagerSecretPolicyPublicScanner();
const secret = { ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-abc123', Name: 'my-secret' };

const publicPolicy = JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: '*', Action: 'secretsmanager:GetSecretValue' }] });
const scopedPolicy = JSON.stringify({ Statement: [{ Effect: 'Allow', Principal: { AWS: 'arn:aws:iam::123456789012:root' }, Action: 'secretsmanager:GetSecretValue' }] });

describe('AwsSecretsManagerSecretPolicyPublicScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('secrets-manager-secret-policy-public');
  });

  it('flags a secret with a public resource policy', async () => {
    mockSend.mockResolvedValueOnce({ SecretList: [secret] }).mockResolvedValueOnce({ ResourcePolicy: publicPolicy });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not flag a secret with a scoped resource policy', async () => {
    mockSend.mockResolvedValueOnce({ SecretList: [secret] }).mockResolvedValueOnce({ ResourcePolicy: scopedPolicy });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag a secret with no resource policy at all', async () => {
    mockSend.mockResolvedValueOnce({ SecretList: [secret] }).mockResolvedValueOnce({});

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListSecretsCommand and GetResourcePolicyCommand', async () => {
    mockSend.mockResolvedValueOnce({ SecretList: [secret] }).mockResolvedValueOnce({});

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListSecretsCommand));
    expect(mockSend).toHaveBeenCalledWith(expect.any(GetResourcePolicyCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError when ListSecrets itself fails, and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
