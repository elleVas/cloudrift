// SPDX-License-Identifier: Apache-2.0
import { DEAD_RESOURCE_KINDS, type DeadResourceKind, type DeadResource } from './dead-resource';
import type { Ec2KeyPairUnused } from './entities/ec2-keypair-unused.entity';
import type { Ec2RiExpiringSoon } from './entities/ec2-ri-expiring-soon.entity';
import type { IamUserInactive } from './entities/iam-user-inactive.entity';
import type { IamPolicyUnattached } from './entities/iam-policy-unattached.entity';

/**
 * Map kind → concrete entity. Allows consumers (formatters) to retrieve the
 * specific type from the kind without manual casts.
 */
export interface DeadResourceKindMap {
  'ec2-keypair-unused': Ec2KeyPairUnused;
  'ec2-ri-expiring-soon': Ec2RiExpiringSoon;
  'iam-user-inactive': IamUserInactive;
  'iam-policy-unattached': IamPolicyUnattached;
}

export type DeadFindingsByKind = {
  [K in DeadResourceKind]: DeadResourceKindMap[K][];
};

export function groupByKind(findings: readonly DeadResource[]): DeadFindingsByKind {
  const grouped = Object.fromEntries(
    DEAD_RESOURCE_KINDS.map((kind) => [kind, []]),
  ) as unknown as DeadFindingsByKind;

  for (const finding of findings) {
    (grouped[finding.kind] as DeadResource[]).push(finding);
  }

  return grouped;
}
