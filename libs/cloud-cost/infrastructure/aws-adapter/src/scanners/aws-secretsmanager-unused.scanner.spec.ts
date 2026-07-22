// SPDX-License-Identifier: Apache-2.0
import { SecretsManagerClient, ListSecretsCommand } from '@aws-sdk/client-secrets-manager';
import { AwsSecretsManagerUnusedScanner } from './aws-secretsmanager-unused.scanner';
import { AwsRegion } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { mockPricing } from '../testing/mock-pricing';

jest.mock('@aws-sdk/client-secrets-manager');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (SecretsManagerClient as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsSecretsManagerUnusedScanner(mockPricing);
const oldDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);

describe('AwsSecretsManagerUnusedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('secretsmanager-unused');
  });

  it('flags a secret never accessed, older than the unused threshold', async () => {
    mockSend.mockResolvedValueOnce({
      SecretList: [
        { ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-abc', Name: 'my-secret', CreatedDate: oldDate },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((s) => s.id)).toEqual([
      'arn:aws:secretsmanager:us-east-1:123456789012:secret:my-secret-abc',
    ]);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(0.4, 2);
  });

  it('does not flag a recently created, never-accessed secret', async () => {
    mockSend.mockResolvedValueOnce({
      SecretList: [
        { ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:fresh-abc', Name: 'fresh', CreatedDate: new Date() },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag a secret accessed recently', async () => {
    mockSend.mockResolvedValueOnce({
      SecretList: [
        {
          ARN: 'arn:aws:secretsmanager:us-east-1:123456789012:secret:active-abc',
          Name: 'active',
          CreatedDate: oldDate,
          LastAccessedDate: new Date(),
        },
      ],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListSecretsCommand', async () => {
    mockSend.mockResolvedValueOnce({ SecretList: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListSecretsCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
