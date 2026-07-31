// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, type RiskVerdict } from './resource-security-policy';
import type { RedshiftClusterPubliclyAccessible } from '../entities/redshift-cluster-publicly-accessible.entity';

/** The scanner only emits clusters that are already publicly accessible — always flagged once emitted. */
export class RedshiftClusterPubliclyAccessiblePolicy extends ResourceSecurityPolicy<RedshiftClusterPubliclyAccessible> {
  protected judge(resource: RedshiftClusterPubliclyAccessible): RiskVerdict {
    return flagged(resource.riskReason);
  }
}
