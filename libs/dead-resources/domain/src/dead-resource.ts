// SPDX-License-Identifier: Apache-2.0
import type { AwsRegion } from 'cloud-cost-domain';

/**
 * One resource kind per always-$0 hygiene finding this domain covers (EC2
 * key pairs, IAM users/policies, expiring Reserved Instances, ...). Deliberately
 * separate from `cloud-cost-domain`'s `ResourceKind`/`WastedResource` (ADR-0078):
 * `WastedResource.costEstimate` is non-optional there, so a domain that is
 * entirely $0 by design would have to fake a real cost field on every
 * finding and print a misleading "$0.00/mo" everywhere.
 */
export const DEAD_RESOURCE_KINDS = [
  'ec2-keypair-unused',
  'ec2-ri-expiring-soon',
  'iam-user-inactive',
  'iam-policy-unattached',
] as const;
export type DeadResourceKind = (typeof DEAD_RESOURCE_KINDS)[number];

/** How urgent a finding is — informational cleanup vs. an actual risk signal. */
export type DeadResourceSeverity = 'info' | 'warning' | 'critical';

/** Whether a kind's scanner is called once per requested region, or exactly once (global AWS services like IAM). See ADR-0078. */
export type DeadResourceScope = 'regional' | 'global';

export interface DeadResourceKindMeta {
  label: string;
  scope: DeadResourceScope;
}

export const DEAD_RESOURCE_KIND_META: Record<DeadResourceKind, DeadResourceKindMeta> = {
  'ec2-keypair-unused': { label: 'EC2 Key Pairs (unused)', scope: 'regional' },
  'ec2-ri-expiring-soon': { label: 'EC2 Reserved Instances (expiring soon)', scope: 'regional' },
  'iam-user-inactive': { label: 'IAM Users (inactive)', scope: 'global' },
  'iam-policy-unattached': { label: 'IAM Policies (unattached)', scope: 'global' },
};

/**
 * The sole inbound-boundary type for this domain (mirrors `WastedResource`
 * in `cloud-cost-domain`, ADR-0014): coordinator, summary and formatters
 * depend only on this interface, never on the concrete entities.
 *
 * `region` is optional: global-scope kinds (IAM) have no single region to
 * report — a fake placeholder would misrepresent real data, so it's omitted
 * instead (see ADR-0078's global-scanner design).
 */
export interface DeadResource {
  readonly id: string;
  readonly kind: DeadResourceKind;
  readonly region?: AwsRegion;
  readonly accountId: string;
  readonly detectedAt: Date;
  readonly tags: Record<string, string>;
  /** Why this was flagged — e.g. "not referenced by any running/stopped EC2 instance". */
  readonly hygieneReason: string;
  readonly severity: DeadResourceSeverity;
}
