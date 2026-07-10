// SPDX-License-Identifier: Apache-2.0
import { Entity } from 'shared-kernel';
import { AwsRegion } from '../value-objects/aws-region.value-object';
import { CostEstimate } from '../value-objects/cost-estimate.value-object';
import type { WastedResource } from '../wasted-resource';

export type RdsInstanceStatus =
  | 'available'
  | 'stopped'
  | 'starting'
  | 'stopping'
  | 'rebooting'
  | 'modifying'
  | 'deleting'
  | 'creating'
  | 'failed';

export interface RdsInstanceProps {
  dbInstanceIdentifier: string;
  region: AwsRegion;
  accountId: string;
  dbInstanceClass: string;
  engine: string;
  dbInstanceStatus: RdsInstanceStatus;
  allocatedStorageGb: number;
  storageType: string;
  multiAZ: boolean;
  detectedAt: Date;
  tags: Record<string, string>;
  monthlyCostUsd: number;
}

export class RdsInstance extends Entity<string> implements WastedResource {
  private readonly props: Readonly<RdsInstanceProps>;

  constructor(props: RdsInstanceProps) {
    super(props.dbInstanceIdentifier);
    this.props = Object.freeze({ ...props });
  }

  get region(): AwsRegion { return this.props.region; }
  get accountId(): string { return this.props.accountId; }
  get dbInstanceClass(): string { return this.props.dbInstanceClass; }
  get engine(): string { return this.props.engine; }
  get dbInstanceStatus(): RdsInstanceStatus { return this.props.dbInstanceStatus; }
  get allocatedStorageGb(): number { return this.props.allocatedStorageGb; }
  get storageType(): string { return this.props.storageType; }
  get multiAZ(): boolean { return this.props.multiAZ; }
  get detectedAt(): Date { return this.props.detectedAt; }
  get tags(): Record<string, string> { return this.props.tags; }

  get kind(): 'rds-instance' { return 'rds-instance'; }
  get wasteReason(): string { return 'stopped (storage and backups still billed)'; }

  isStopped(): boolean {
    return this.props.dbInstanceStatus === 'stopped';
  }

  get costEstimate(): CostEstimate {
    return CostEstimate.of(
      this.props.monthlyCostUsd,
      `${this.props.allocatedStorageGb} GB ${this.props.storageType} RDS storage (stopped)`,
    );
  }
}
