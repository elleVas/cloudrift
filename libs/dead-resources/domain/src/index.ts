// SPDX-License-Identifier: Apache-2.0
// Re-exported from cloud-cost-domain: a generic AWS value object this domain
// needs too, not duplicated here to avoid two region-code lists drifting
// out of sync (ADR-0078).
export { AwsRegion } from 'cloud-cost-domain';

// Dead resource model
export { DEAD_RESOURCE_KINDS, DEAD_RESOURCE_KIND_META } from './dead-resource';
export type {
  DeadResourceKind,
  DeadResourceSeverity,
  DeadResourceScope,
  DeadResourceKindMeta,
  DeadResource,
} from './dead-resource';
export { groupByKind } from './group-by-kind';
export type { DeadResourceKindMap, DeadFindingsByKind } from './group-by-kind';

// Entities
export { Ec2KeyPairUnused } from './entities/ec2-keypair-unused.entity';
export type { Ec2KeyPairUnusedProps } from './entities/ec2-keypair-unused.entity';
export { Ec2RiExpiringSoon } from './entities/ec2-ri-expiring-soon.entity';
export type { Ec2RiExpiringSoonProps } from './entities/ec2-ri-expiring-soon.entity';
export { IamUserInactive } from './entities/iam-user-inactive.entity';
export type { IamUserInactiveProps } from './entities/iam-user-inactive.entity';
export { IamPolicyUnattached } from './entities/iam-policy-unattached.entity';
export type { IamPolicyUnattachedProps } from './entities/iam-policy-unattached.entity';

// Policies
export {
  DeadResourcePolicy,
  flagged,
  notFlagged,
  DEFAULT_MIN_AGE_DAYS,
  DEFAULT_IGNORE_TAG,
} from './policies/dead-resource-policy';
export type { HygieneVerdict, DeadResourcePolicyOptions } from './policies/dead-resource-policy';
export { Ec2KeyPairUnusedPolicy } from './policies/ec2-keypair-unused.policy';
export { Ec2RiExpiringSoonPolicy, DEFAULT_EXPIRING_WITHIN_DAYS } from './policies/ec2-ri-expiring-soon.policy';
export { IamUserInactivePolicy, DEFAULT_INACTIVITY_DAYS } from './policies/iam-user-inactive.policy';
export { IamPolicyUnattachedPolicy } from './policies/iam-policy-unattached.policy';

// Ports
export type { DeadResourceScannerPort } from './ports/outbound/dead-resource-scanner.port';
export type {
  FindDeadResourcesRequest,
  DeadResourceScanError,
  DeadResourcesSummary,
  FindDeadResourcesUseCasePort,
} from './ports/inbound/find-dead-resources.use-case.port';
