// SPDX-License-Identifier: Apache-2.0
import { EventBridgeClient, ListRulesCommand } from '@aws-sdk/client-eventbridge';
import { AwsEventbridgeRuleNoTargetsScanner } from './aws-eventbridge-rule-no-targets.scanner';
import { AwsRegion } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-eventbridge');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (EventBridgeClient as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsEventbridgeRuleNoTargetsScanner();

/** ListRules -> (per rule) ListTargetsByRule, in that call order. */
function queueRule(arn: string, name: string, targets: unknown[]): void {
  mockSend.mockResolvedValueOnce({ Rules: [{ Arn: arn, Name: name }] }).mockResolvedValueOnce({ Targets: targets });
}

describe('AwsEventbridgeRuleNoTargetsScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('eventbridge-rule-no-targets');
  });

  it('flags a rule with no targets', async () => {
    queueRule('arn:aws:events:us-east-1:123:rule/orphan', 'orphan', []);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((r) => r.id)).toEqual(['arn:aws:events:us-east-1:123:rule/orphan']);
  });

  it('does not flag a rule with at least one target', async () => {
    queueRule('arn:aws:events:us-east-1:123:rule/active', 'active', [{ Id: 'target-1' }]);

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('sends ListRulesCommand', async () => {
    mockSend.mockResolvedValueOnce({ Rules: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListRulesCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValue(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
