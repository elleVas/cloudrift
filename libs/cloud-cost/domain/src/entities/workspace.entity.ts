// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export interface WorkspaceProps {
  workspaceId: string;
  region: AwsRegion;
  accountId: string;
  userName: string;
  computeTypeName: string;
  /** Only AlwaysOn WorkSpaces are in scope: AutoStop bills per hour used, not a fixed cost at rest. */
  runningMode: string;
  /** `undefined` if the user never connected since creation. */
  lastKnownUserConnectionTimestamp: Date | undefined;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class Workspace extends Entity<string> implements WastedResource {
  private readonly props: Readonly<WorkspaceProps>;

  constructor(props: WorkspaceProps) {
    super(props.workspaceId);
    this.props = this.deepFreeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get userName(): string { return this.props.userName; }
  get computeTypeName(): string { return this.props.computeTypeName; }
  get runningMode(): string { return this.props.runningMode; }
  get lastKnownUserConnectionTimestamp(): Date | undefined { return this.props.lastKnownUserConnectionTimestamp; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'workspaces-idle' { return 'workspaces-idle'; }
  get wasteReason(): string {
    return this.props.lastKnownUserConnectionTimestamp === undefined
      ? 'never connected'
      : `no user connection since ${this.props.lastKnownUserConnectionTimestamp.toISOString().split('T')[0]}`;
  }

  isAlwaysOn(): boolean {
    return this.props.runningMode === 'ALWAYS_ON';
  }

  /** True if never connected, or the last connection is older than `windowDays`. */
  isIdle(now: Date, windowDays: number): boolean {
    if (this.props.lastKnownUserConnectionTimestamp === undefined) return true;
    const ageDays = (now.getTime() - this.props.lastKnownUserConnectionTimestamp.getTime()) / (24 * 60 * 60 * 1000);
    return ageDays >= windowDays;
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(this.props.monthlyCostUsd, `Idle ${this.props.computeTypeName} WorkSpace`);
  }
}
