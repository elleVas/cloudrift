// SPDX-License-Identifier: Apache-2.0
import { WorkSpacesClient } from '@aws-sdk/client-workspaces';
import { AwsWorkspacesIdleScanner } from './aws-workspaces-idle.scanner';
import { AwsRegion, type Workspace } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';

jest.mock('@aws-sdk/client-workspaces');

const mockSend = jest.fn();
const mockDestroy = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (WorkSpacesClient as jest.Mock).mockImplementation(() => ({ send: mockSend, destroy: mockDestroy }));
});

const region = AwsRegion.create('us-east-1');
const mockPricingSource = { getWorkSpacesBundlePricePerMonth: jest.fn().mockResolvedValue(35) };
const scanner = new AwsWorkspacesIdleScanner(mockPricingSource);

function mockWorkspace(workspaceId: string, runningMode = 'ALWAYS_ON') {
  mockSend.mockResolvedValueOnce({
    Workspaces: [
      {
        WorkspaceId: workspaceId,
        UserName: 'jdoe',
        WorkspaceProperties: { RunningMode: runningMode, ComputeTypeName: 'VALUE' },
      },
    ],
  });
}

describe('AwsWorkspacesIdleScanner', () => {
  it('exposes its resource kind', () => {
    expect(scanner.kind).toBe('workspaces-idle');
  });

  it('reports an AlwaysOn WorkSpace that never connected', async () => {
    mockWorkspace('ws-1');
    mockSend.mockResolvedValueOnce({
      WorkspacesConnectionStatus: [{ WorkspaceId: 'ws-1', LastKnownUserConnectionTimestamp: undefined }],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((w) => w.id)).toEqual(['ws-1']);
    expect(result.value[0].costEstimate.monthlyCostUsd).toBeCloseTo(35, 2);
    expect((result.value[0] as Workspace).userName).toBe('jdoe');
  });

  it('reports an AlwaysOn WorkSpace with no connection in the last 30 days', async () => {
    mockWorkspace('ws-2');
    const old = new Date();
    old.setDate(old.getDate() - 45);
    mockSend.mockResolvedValueOnce({
      WorkspacesConnectionStatus: [{ WorkspaceId: 'ws-2', LastKnownUserConnectionTimestamp: old }],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.map((w) => w.id)).toEqual(['ws-2']);
  });

  it('does not report a WorkSpace with a recent connection', async () => {
    mockWorkspace('ws-recent');
    mockSend.mockResolvedValueOnce({
      WorkspacesConnectionStatus: [{ WorkspaceId: 'ws-recent', LastKnownUserConnectionTimestamp: new Date() }],
    });

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
  });

  it('ignores AutoStop WorkSpaces entirely (not a fixed cost at rest)', async () => {
    mockWorkspace('ws-autostop', 'AUTO_STOP');

    const result = await scanner.scan(region);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toHaveLength(0);
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('returns Result.fail wrapping AwsAdapterError and destroys the client on error', async () => {
    mockSend.mockRejectedValueOnce(new Error('boom'));

    const result = await scanner.scan(region);

    expect(result.ok).toBe(false);
    if (!result.ok) expect((result.error as AwsAdapterError).service).toBe('WorkSpaces');
    expect(mockDestroy).toHaveBeenCalledTimes(1);
  });
});
