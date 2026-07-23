// SPDX-License-Identifier: Apache-2.0
import type { Result } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { DeadResourceKind, DeadResource, DeadResourceScope } from '../../dead-resource';

/**
 * Single outbound port for hygiene detection: each resource kind is an
 * implementation (plugin) of this port. The contract requires the scanner
 * to return only resources already confirmed by the corresponding domain
 * policy (same shape as `cloud-cost-domain`'s `WasteScannerPort`).
 *
 * `scope` (default `'regional'`) tells the coordinator how many jobs to
 * create: a `'global'` scanner (IAM) is called exactly once regardless of
 * how many regions were requested — the `region` it receives in that call is
 * an arbitrary one of the requested regions and MUST be ignored by the
 * implementation (a global AWS service has no real region). See ADR-0078.
 */
export interface DeadResourceScannerPort {
  readonly kind: DeadResourceKind;
  readonly scope?: DeadResourceScope;
  scan(region: AwsRegion): Promise<Result<DeadResource[]>>;
}
