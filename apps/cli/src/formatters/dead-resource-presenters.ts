// SPDX-License-Identifier: Apache-2.0
import type { DeadResourceKind, DeadResourceKindMap, DeadResource } from 'dead-resources-domain';

/**
 * Presentation per dead-resource kind. Mirrors `resource-presenters.ts`'s
 * shape and exhaustive-switch dispatch (ADR-0059) for the `WastedResource`
 * domain — same reasoning applies here: adding a new `DeadResourceKind`
 * forces (via the compiler) adding the presenter here and a case in
 * `rowFor`/`recommendFor` below.
 */
export interface DeadResourcePresenter<T extends DeadResource = DeadResource> {
  title: string;
  /** Column headers, severity excluded (added by the formatters as the last column). */
  head: string[];
  row(resource: T): string[];
  recommend(resource: T): string;
}

function day(date: Date): string {
  return date.toISOString().split('T')[0];
}

type PresenterMap = { [K in DeadResourceKind]: DeadResourcePresenter<DeadResourceKindMap[K]> };

export const presenters: PresenterMap = {
  'ec2-keypair-unused': {
    // Unlike WastedResource's opaque IDs (vol-…, i-…), a key pair's `KeyName`
    // is already the human-chosen label — no separate Name-tag column needed
    // (see ADR-0076 for why that pattern exists elsewhere).
    title: 'EC2 Key Pairs — Unused',
    head: ['Key Pair ID', 'Key Name', 'Region', 'Created'],
    row: (kp) => [kp.id, kp.keyName, kp.region.code, day(kp.createdAt)],
    recommend: (kp) => `Delete unused EC2 key pair "${kp.keyName}" (${kp.id}) in ${kp.region.code}`,
  },
  'ec2-ri-expiring-soon': {
    title: 'EC2 Reserved Instances — Expiring soon',
    head: ['Reserved Instance ID', 'Instance Type', 'Count', 'Region', 'Expires'],
    row: (ri) => [ri.id, ri.instanceType, String(ri.instanceCount), ri.region.code, day(ri.end)],
    recommend: (ri) =>
      `Decide whether to renew Reserved Instance ${ri.id} (${ri.instanceType} × ${ri.instanceCount}) in ${ri.region.code} — ${ri.hygieneReason}`,
  },
  // No Region column for the two IAM kinds below — IAM is a global AWS
  // service, `region` is unset on these entities (see ADR-0078).
  'iam-user-inactive': {
    title: 'IAM Users — Inactive',
    head: ['User Name', 'ARN', 'Created'],
    row: (u) => [u.userName, u.arn, day(u.createdAt)],
    recommend: (u) => `Review/deactivate IAM user "${u.userName}" (${u.arn}) — ${u.hygieneReason}`,
  },
  'iam-policy-unattached': {
    title: 'IAM Policies — Unattached',
    head: ['Policy Name', 'ARN', 'Created'],
    row: (p) => [p.policyName, p.arn, day(p.createdAt)],
    recommend: (p) => `Delete unattached IAM policy "${p.policyName}" (${p.arn})`,
  },
};

export function presenterFor(kind: DeadResourceKind): Omit<DeadResourcePresenter, 'row' | 'recommend'> {
  return presenters[kind];
}

/** Exhaustive switch on `finding.kind` (ADR-0059) — a missing case fails the build. */
export function rowFor(finding: DeadResourceKindMap[DeadResourceKind]): string[] {
  switch (finding.kind) {
    case 'ec2-keypair-unused':
      return presenters['ec2-keypair-unused'].row(finding);
    case 'ec2-ri-expiring-soon':
      return presenters['ec2-ri-expiring-soon'].row(finding);
    case 'iam-user-inactive':
      return presenters['iam-user-inactive'].row(finding);
    case 'iam-policy-unattached':
      return presenters['iam-policy-unattached'].row(finding);
  }
}

export function recommendFor(finding: DeadResourceKindMap[DeadResourceKind]): string {
  switch (finding.kind) {
    case 'ec2-keypair-unused':
      return presenters['ec2-keypair-unused'].recommend(finding);
    case 'ec2-ri-expiring-soon':
      return presenters['ec2-ri-expiring-soon'].recommend(finding);
    case 'iam-user-inactive':
      return presenters['iam-user-inactive'].recommend(finding);
    case 'iam-policy-unattached':
      return presenters['iam-policy-unattached'].recommend(finding);
  }
}
