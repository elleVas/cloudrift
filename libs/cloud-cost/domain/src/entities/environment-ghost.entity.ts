// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export type EnvironmentGhostDetectionMethod = 'tag' | 'naming-pattern';

export interface EnvironmentGhostProps {
  environmentName: string;
  detectionMethod: EnvironmentGhostDetectionMethod;
  /** Resources evaluated for this group — only EC2 instances, RDS instances, Lambda functions and load balancers count (see AwsEnvironmentGhostScanner). */
  resourceCount: number;
  /** Unique resource-type labels present in the group, e.g. ['ec2-instance', 'rds-instance']. */
  resourceTypes: string[];
  inactiveResourceCount: number;
  /** Most recent per-resource activity proxy across the group (stoppedSince/lastModified/createdTime) — the signal the grace period is measured from. */
  lastActivityTimestamp: Date;
  region: AwsRegion;
  accountId: string;
  tags: Record<string, string>;
  detectedAt: Date;
}

/**
 * A group of resources (correlated by an environment/branch tag, or as a
 * fallback by an ephemeral-environment naming convention) that all look
 * inactive at once — the signature of a Dev/PR environment nobody tore
 * down. Evaluates only EC2 instances, RDS instances, Lambda functions and
 * load balancers (ADR-0065 Phase 6.4): the resource types cloudrift already
 * has a reliable state/idle signal for, out of the many types an ephemeral
 * environment could contain. Other tagged/named resources in the same group
 * (S3, DynamoDB, ...) are out of scope for this iteration. No direct AWS
 * cost is attached to the group itself — like `eni-orphaned`, this is a
 * hygiene flag pointing at where to look, not a priced saving.
 */
export class EnvironmentGhost extends Entity<string> implements WastedResource {
  private readonly props: Readonly<EnvironmentGhostProps>;

  constructor(props: EnvironmentGhostProps) {
    super(props.environmentName);
    this.props = this.deepFreeze({ ...props });
  }

  get environmentName(): string { return this.props.environmentName; }
  get detectionMethod(): EnvironmentGhostDetectionMethod { return this.props.detectionMethod; }
  get resourceCount(): number { return this.props.resourceCount; }
  get resourceTypes(): string[] { return this.props.resourceTypes; }
  get inactiveResourceCount(): number { return this.props.inactiveResourceCount; }
  get lastActivityTimestamp(): Date { return this.props.lastActivityTimestamp; }
  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get tags(): Record<string, string> { return this.props.tags; }

  get detectedAt(): Date { return this.props.detectedAt; }
  get kind(): 'environment-ghost' { return 'environment-ghost'; }
  get wasteReason(): string {
    return `${this.props.resourceCount} resource(s) inactive (${this.props.detectionMethod}), last activity ${this.props.lastActivityTimestamp.toISOString().split('T')[0]}`;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(0, 'Ghost environment (hygiene flag, no direct cost — verify before deleting)');
  }
}
