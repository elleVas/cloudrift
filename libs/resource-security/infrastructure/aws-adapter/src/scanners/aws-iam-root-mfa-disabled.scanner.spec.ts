// SPDX-License-Identifier: Apache-2.0
import { IAMClient, GetAccountSummaryCommand } from '@aws-sdk/client-iam';
import { AwsIamRootMfaDisabledScanner } from './aws-iam-root-mfa-disabled.scanner';
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
const scanner = new AwsIamRootMfaDisabledScanner();

describe('AwsIamRootMfaDisabledScanner', () => {
  it('exposes its resource kind and global scope', () => {
    expect(scanner.kind).toBe('iam-root-mfa-disabled');
    expect(scanner.scope).toBe('global');
  });

  it('flags when root MFA is disabled', async () => {
    mockSend.mockResolvedValueOnce({ SummaryMap: { AccountMFAEnabled: 0 } });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not flag when root MFA is enabled', async () => {
    mockSend.mockResolvedValueOnce({ SummaryMap: { AccountMFAEnabled: 1 } });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends GetAccountSummaryCommand', async () => {
    mockSend.mockResolvedValueOnce({ SummaryMap: { AccountMFAEnabled: 1 } });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(GetAccountSummaryCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
