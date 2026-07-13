// SPDX-License-Identifier: Apache-2.0
import {
  WorkSpacesClient,
  DescribeWorkspacesCommand,
  DescribeWorkspacesConnectionStatusCommand,
  type Workspace as SdkWorkspace,
} from '@aws-sdk/client-workspaces';
import { Result, createLogger } from 'shared-kernel';
import type { AwsRegion, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { Workspace, WorkspacesIdlePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { createAwsClientConfig } from '../utils/client-config';
import { paginate } from '../utils/paginate';
import { mapWithConcurrency } from '../utils/map-with-concurrency';

const logger = createLogger('cloudrift:scanner');
const PRICING_CONCURRENCY = 5;
/** `DescribeWorkspacesConnectionStatus` accepts at most 25 WorkSpace IDs per call. */
const CONNECTION_STATUS_BATCH_SIZE = 25;

export interface WorkSpacesBundlePricingSource {
  getWorkSpacesBundlePricePerMonth(region: AwsRegion, computeTypeName: string): Promise<number | undefined>;
}

type WorkspaceWithId = SdkWorkspace & { WorkspaceId: string };

/**
 * Detects AlwaysOn WorkSpaces with no user connection in the configured
 * window (AWS's own recommended idle-detection approach via
 * `DescribeWorkspacesConnectionStatus`, not CloudWatch). AutoStop WorkSpaces
 * bill per hour used, not a fixed cost at rest, so they're out of scope
 * (ADR-0038/ADR-0001) — only `RunningMode === 'ALWAYS_ON'` is scanned.
 * Requires `--live-pricing`: without a price per bundle compute type, no
 * saving can be estimated.
 */
export class AwsWorkspacesIdleScanner implements WasteScannerPort {
  readonly kind = 'workspaces-idle' as const;

  constructor(
    private readonly pricing: WorkSpacesBundlePricingSource,
    private readonly accountId = 'unknown',
    private readonly policy = new WorkspacesIdlePolicy(),
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const workspaces = new WorkSpacesClient({ ...createAwsClientConfig(), region: region.code });
    try {
      const rawWorkspaces = await paginate<SdkWorkspace>(async (cursor) => {
        const r = await workspaces.send(new DescribeWorkspacesCommand({ NextToken: cursor }));
        return { items: r.Workspaces ?? [], cursor: r.NextToken };
      });

      const runningModeMatches = rawWorkspaces.filter(
        (w) => w.WorkspaceProperties?.RunningMode === 'ALWAYS_ON',
      );
      const alwaysOn = runningModeMatches.filter((w): w is WorkspaceWithId => !!w.WorkspaceId);
      if (alwaysOn.length !== runningModeMatches.length) {
        logger.debug(
          `${this.kind}: skipped ${runningModeMatches.length - alwaysOn.length} entries missing WorkspaceId`,
        );
      }
      if (alwaysOn.length === 0) return Result.ok([]);

      const lastConnectionByWorkspaceId = new Map<string, Date | undefined>();
      for (let i = 0; i < alwaysOn.length; i += CONNECTION_STATUS_BATCH_SIZE) {
        const batch = alwaysOn.slice(i, i + CONNECTION_STATUS_BATCH_SIZE).map((w) => w.WorkspaceId);
        const r = await workspaces.send(
          new DescribeWorkspacesConnectionStatusCommand({ WorkspaceIds: batch }),
        );
        for (const status of r.WorkspacesConnectionStatus ?? []) {
          if (!status.WorkspaceId) {
            logger.debug(`${this.kind}: skipped a connection-status entry missing WorkspaceId`);
            continue;
          }
          lastConnectionByWorkspaceId.set(status.WorkspaceId, status.LastKnownUserConnectionTimestamp);
        }
      }

      const computeTypes = [
        ...new Set(alwaysOn.map((w) => w.WorkspaceProperties?.ComputeTypeName ?? 'VALUE')),
      ];
      const priceEntries = await mapWithConcurrency(computeTypes, PRICING_CONCURRENCY, async (computeType) => ({
        computeType,
        price: (await this.pricing.getWorkSpacesBundlePricePerMonth(region, computeType)) ?? 0,
      }));
      const priceByType = new Map(priceEntries.map((e) => [e.computeType, e.price]));

      const now = new Date();
      const idle = alwaysOn
        .map((w) => {
          const computeTypeName = w.WorkspaceProperties?.ComputeTypeName ?? 'VALUE';
          return new Workspace({
            workspaceId: w.WorkspaceId,
            region,
            accountId: this.accountId,
            computeTypeName,
            runningMode: w.WorkspaceProperties?.RunningMode ?? 'ALWAYS_ON',
            lastKnownUserConnectionTimestamp: lastConnectionByWorkspaceId.get(w.WorkspaceId),
            detectedAt: now,
            tags: {},
            monthlyCostUsd: +(priceByType.get(computeTypeName) ?? 0).toFixed(4),
          });
        })
        .filter((w) => this.policy.evaluate(w, now).isWaste);

      return Result.ok(idle);
    } catch (err) {
      return Result.fail(new AwsAdapterError('WorkSpaces', err as Error));
    } finally {
      workspaces.destroy();
    }
  }
}
