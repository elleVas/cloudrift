// SPDX-License-Identifier: Apache-2.0
import { SecurityHubClient, DescribeHubCommand } from '@aws-sdk/client-securityhub';
import { AwsSecurityHubNotEnabledScanner } from './aws-security-hub-not-enabled.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from 'shared-aws-infra-utils';

jest.mock('@aws-sdk/client-securityhub');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (SecurityHubClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsSecurityHubNotEnabledScanner();

function invalidAccessError(): Error {
  const err = new Error('Account is not subscribed to AWS Security Hub');
  err.name = 'InvalidAccessException';
  return err;
}

describe('AwsSecurityHubNotEnabledScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('security-hub-not-enabled');
  });

  it('flags a region where Security Hub is not enabled', async () => {
    mockSend.mockRejectedValueOnce(invalidAccessError());

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not flag a region where Security Hub is enabled', async () => {
    mockSend.mockResolvedValueOnce({ HubArn: 'arn:aws:securityhub:us-east-1:123456789012:hub/default' });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends DescribeHubCommand', async () => {
    mockSend.mockResolvedValueOnce({});

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(DescribeHubCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on an unrelated SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
