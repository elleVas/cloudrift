// SPDX-License-Identifier: Apache-2.0
import { EnvironmentGhost } from './environment-ghost.entity';
import type { EnvironmentGhostProps } from './environment-ghost.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('us-east-1');

function makeGhost(overrides: Partial<EnvironmentGhostProps> = {}): EnvironmentGhost {
  return new EnvironmentGhost({
    environmentName: 'pr-1234',
    detectionMethod: 'tag',
    resourceCount: 4,
    resourceTypes: ['ec2-instance', 'rds-instance'],
    inactiveResourceCount: 4,
    lastActivityTimestamp: new Date('2026-05-01'),
    region,
    accountId: '123456789012',
    tags: {},
    detectedAt: new Date('2026-06-09'),
    ...overrides,
  });
}

describe('EnvironmentGhost', () => {
  it('exposes correct id and fields', () => {
    const ghost = makeGhost();
    expect(ghost.id).toBe('pr-1234');
    expect(ghost.resourceCount).toBe(4);
    expect(ghost.resourceTypes).toEqual(['ec2-instance', 'rds-instance']);
  });

  it('exposes kind', () => {
    expect(makeGhost().kind).toBe('environment-ghost');
  });

  it('wasteReason references the tag detection method', () => {
    const reason = makeGhost({
      detectionMethod: 'tag',
      resourceCount: 4,
      lastActivityTimestamp: new Date('2026-05-01'),
    }).wasteReason;
    expect(reason).toBe('4 resource(s) inactive (tag), last activity 2026-05-01');
  });

  it('wasteReason references the naming-pattern detection method', () => {
    const reason = makeGhost({
      detectionMethod: 'naming-pattern',
      resourceCount: 2,
      lastActivityTimestamp: new Date('2026-04-15'),
    }).wasteReason;
    expect(reason).toBe('2 resource(s) inactive (naming-pattern), last activity 2026-04-15');
  });

  it('costEstimate returns zero with a hygiene-flag description', () => {
    const costEstimate = makeGhost().costEstimate;
    expect(costEstimate.monthlyCostUsd).toBe(0);
    expect(costEstimate.description).toContain('hygiene flag');
  });

  it('exposes the remaining props', () => {
    const lastActivityTimestamp = new Date('2026-03-01');
    const detectedAt = new Date('2026-06-09');
    const ghost = makeGhost({
      region,
      accountId: '999999999999',
      inactiveResourceCount: 3,
      lastActivityTimestamp,
      detectedAt,
      tags: { env: 'staging' },
    });
    expect(ghost.region).toBe(region);
    expect(ghost.accountId).toBe('999999999999');
    expect(ghost.inactiveResourceCount).toBe(3);
    expect(ghost.lastActivityTimestamp).toBe(lastActivityTimestamp);
    expect(ghost.detectedAt).toBe(detectedAt);
    expect(ghost.tags).toEqual({ env: 'staging' });
  });
});
