// SPDX-License-Identifier: Apache-2.0
import type { Result } from 'shared-kernel';
import type { AwsRegion } from 'cloud-cost-domain';
import type { ResourceSecurityKind, SecurityFinding, ResourceSecurityScope } from '../../resource-security';

/**
 * Single outbound port for security-posture detection: each check kind is
 * an implementation (plugin) of this port. Mirrors `dead-resources-domain`'s
 * `DeadResourceScannerPort`.
 *
 * `scope` (default `'regional'`) tells the coordinator how many jobs to
 * create: a `'global'` scanner (IAM, S3 bucket listing, CloudTrail) is
 * called exactly once regardless of how many regions were requested — the
 * `region` it receives in that call is an arbitrary one of the requested
 * regions and MUST be ignored by the implementation.
 */
export interface ResourceSecurityScannerPort {
  readonly kind: ResourceSecurityKind;
  readonly scope?: ResourceSecurityScope;
  scan(region: AwsRegion): Promise<Result<SecurityFinding[]>>;
}
