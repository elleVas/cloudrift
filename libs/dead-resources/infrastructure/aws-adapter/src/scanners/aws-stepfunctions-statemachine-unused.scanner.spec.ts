// SPDX-License-Identifier: Apache-2.0
import { SFNClient, ListStateMachinesCommand } from '@aws-sdk/client-sfn';
import { AwsStepfunctionsStatemachineUnusedScanner } from './aws-stepfunctions-statemachine-unused.scanner';
import { AwsRegion } from 'dead-resources-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-sfn');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (SFNClient as jest.Mock).mockImplementation(() => ({
    send: mockSend,
    destroy: mockDestroy,
  }));
});

const region = AwsRegion.create('us-east-1');
const scanner = new AwsStepfunctionsStatemachineUnusedScanner();
const oldDate = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

/** ListStateMachines -> (per STANDARD machine) ListExecutions, in that call order. */
function queueMachine(machine: unknown, executions: unknown[]): void {
  mockSend.mockResolvedValueOnce({ stateMachines: [machine] }).mockResolvedValueOnce({ executions });
}

describe('AwsStepfunctionsStatemachineUnusedScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('stepfunctions-statemachine-unused');
  });

  it('flags an old STANDARD state machine with zero executions', async () => {
    queueMachine(
      { stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:idle', name: 'idle', type: 'STANDARD', creationDate: oldDate },
      [],
    );

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((m) => m.id)).toEqual(['arn:aws:states:us-east-1:123:stateMachine:idle']);
  });

  it('does not flag a state machine with at least one execution', async () => {
    queueMachine(
      { stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:active', name: 'active', type: 'STANDARD', creationDate: oldDate },
      [{ executionArn: 'arn:aws:states:us-east-1:123:execution:active:run-1' }],
    );

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('does not flag a state machine created within the grace period', async () => {
    queueMachine(
      { stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:new', name: 'new', type: 'STANDARD', creationDate: new Date() },
      [],
    );

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('skips EXPRESS-type state machines entirely (no ListExecutions call for them)', async () => {
    mockSend.mockResolvedValueOnce({
      stateMachines: [{ stateMachineArn: 'arn:aws:states:us-east-1:123:stateMachine:fast', name: 'fast', type: 'EXPRESS', creationDate: oldDate }],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('sends ListStateMachinesCommand', async () => {
    mockSend.mockResolvedValueOnce({ stateMachines: [] });

    await scanner.scan(region);

    expect(mockSend).toHaveBeenCalledWith(expect.any(ListStateMachinesCommand));
  });

  it('returns Result.fail wrapping AwsAdapterError on SDK error and destroys the client', async () => {
    mockSend.mockRejectedValue(new Error('AccessDenied'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(AwsAdapterError);
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
