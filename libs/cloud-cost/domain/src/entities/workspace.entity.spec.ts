// SPDX-License-Identifier: Apache-2.0
import { Workspace } from './workspace.entity';
import type { WorkspaceProps } from './workspace.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeWorkspace(overrides: Partial<WorkspaceProps> = {}): Workspace {
  return new Workspace({
    workspaceId: 'ws-0123456789',
    region,
    accountId: '123456789012',
    userName: 'jdoe',
    computeTypeName: 'STANDARD',
    runningMode: 'ALWAYS_ON',
    lastKnownUserConnectionTimestamp: undefined,
    detectedAt: new Date('2026-06-09'),
    tags: {},
    monthlyCostUsd: 35,
    ...overrides,
  });
}

describe('Workspace', () => {
  it('exposes correct id and fields', () => {
    const workspace = makeWorkspace();
    expect(workspace.id).toBe('ws-0123456789');
    expect(workspace.userName).toBe('jdoe');
    expect(workspace.computeTypeName).toBe('STANDARD');
  });

  it('exposes kind', () => {
    expect(makeWorkspace().kind).toBe('workspaces-idle');
  });

  it('wasteReason is "never connected" when lastKnownUserConnectionTimestamp is absent', () => {
    expect(makeWorkspace({ lastKnownUserConnectionTimestamp: undefined }).wasteReason).toBe('never connected');
  });

  it('wasteReason references the last connection date when present', () => {
    const workspace = makeWorkspace({ lastKnownUserConnectionTimestamp: new Date('2026-01-15') });
    expect(workspace.wasteReason).toBe('no user connection since 2026-01-15');
  });

  it('isAlwaysOn is true for ALWAYS_ON running mode', () => {
    expect(makeWorkspace({ runningMode: 'ALWAYS_ON' }).isAlwaysOn()).toBe(true);
  });

  it('isAlwaysOn is false for AUTO_STOP running mode', () => {
    expect(makeWorkspace({ runningMode: 'AUTO_STOP' }).isAlwaysOn()).toBe(false);
  });

  it('isIdle is true when the WorkSpace never connected', () => {
    const workspace = makeWorkspace({ lastKnownUserConnectionTimestamp: undefined });
    expect(workspace.isIdle(new Date('2026-06-09'), 30)).toBe(true);
  });

  it('isIdle is true when the last connection is older than the window', () => {
    const workspace = makeWorkspace({ lastKnownUserConnectionTimestamp: new Date('2026-01-01') });
    expect(workspace.isIdle(new Date('2026-06-09'), 30)).toBe(true);
  });

  it('isIdle is false when the last connection is within the window', () => {
    const workspace = makeWorkspace({ lastKnownUserConnectionTimestamp: new Date('2026-06-08') });
    expect(workspace.isIdle(new Date('2026-06-09'), 30)).toBe(false);
  });

  it('costEstimate returns the fixed monthly cost', () => {
    expect(makeWorkspace().costEstimate.monthlyCostUsd).toBe(35);
  });

  it('exposes the remaining props', () => {
    const lastKnownUserConnectionTimestamp = new Date('2026-05-01');
    const detectedAt = new Date('2026-06-09');
    const workspace = makeWorkspace({
      region,
      accountId: '999999999999',
      runningMode: 'AUTO_STOP',
      lastKnownUserConnectionTimestamp,
      detectedAt,
      tags: { env: 'prod' },
    });
    expect(workspace.region).toBe(region);
    expect(workspace.accountId).toBe('999999999999');
    expect(workspace.runningMode).toBe('AUTO_STOP');
    expect(workspace.lastKnownUserConnectionTimestamp).toBe(lastKnownUserConnectionTimestamp);
    expect(workspace.detectedAt).toBe(detectedAt);
    expect(workspace.tags).toEqual({ env: 'prod' });
  });
});
