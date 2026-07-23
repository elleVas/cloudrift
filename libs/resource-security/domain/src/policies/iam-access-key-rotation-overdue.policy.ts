// SPDX-License-Identifier: Apache-2.0
import { ResourceSecurityPolicy, flagged, notFlagged, type RiskVerdict } from './resource-security-policy';
import type { IamAccessKeyRotationOverdue } from '../entities/iam-access-key-rotation-overdue.entity';

/** CIS AWS Foundations Benchmark's own threshold for access-key rotation. */
export const DEFAULT_ACCESS_KEY_MAX_AGE_DAYS = 90;

export class IamAccessKeyRotationOverduePolicy extends ResourceSecurityPolicy<IamAccessKeyRotationOverdue> {
  constructor(
    options = {},
    private readonly maxAgeDays = DEFAULT_ACCESS_KEY_MAX_AGE_DAYS,
  ) {
    super(options);
  }

  protected judge(resource: IamAccessKeyRotationOverdue, now: Date): RiskVerdict {
    if (this.ageInDays(resource.createdAt, now) < this.maxAgeDays) {
      return notFlagged(`created within the last ${this.maxAgeDays}d`);
    }
    return flagged(resource.riskReason);
  }
}
