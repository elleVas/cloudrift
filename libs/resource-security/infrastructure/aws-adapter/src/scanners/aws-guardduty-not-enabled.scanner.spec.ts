// SPDX-License-Identifier: Apache-2.0
import { GuardDutyClient, ListDetectorsCommand } from '@aws-sdk/client-guardduty';
import { AwsGuarddutyNotEnabledScanner } from './aws-guardduty-not-enabled.scanner';
import { AwsRegion } from 'resource-security-domain';
import { AwsAdapterError } from 'shared-aws-infra-utils';

jest.mock('@aws-sdk/client-guardduty');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (GuardDutyClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsGuarddutyNotEnabledScanner();

describe('AwsGuarddutyNotEnabledScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('guardduty-not-enabled');
  });

  it('flags a region with no detector', async () => {
    mockSend.mockResolvedValueOnce({ DetectorIds: [] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(1);
  });

  it('does not flag a region with a detector', async () => {
    mockSend.mockResolvedValueOnce({ DetectorIds: ['abc123'] });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListDetectorsCommand', async () => {
    mockSend.mockResolvedValueOnce({ DetectorIds: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListDetectorsCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValueOnce(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
