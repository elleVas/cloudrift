// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict, type WastePolicyOptions } from './waste-policy';
import type { SecretsManagerUnused } from '../entities/secretsmanager-unused.entity';

export class SecretsManagerUnusedPolicy extends WastePolicy<SecretsManagerUnused> {
  /** unusedDays: days since last access (or creation, if never accessed) after which a secret is "unused". Default 30 — longer than the base grace period, since infrequent-but-legitimate access patterns exist; `minAgeDays`'s grace period does not apply here (same reasoning as SqsDlqAbandonedWastePolicy). */
  constructor(options: WastePolicyOptions = {}, private readonly unusedDays = 30) {
    super(options);
  }

  protected judge(secret: SecretsManagerUnused, now: Date): WasteVerdict {
    const referenceDate = secret.lastAccessedDate ?? secret.createdDate;
    const idleDays = this.ageInDays(referenceDate, now);
    if (idleDays < this.unusedDays) {
      return notWaste(
        `${secret.lastAccessedDate ? 'last accessed' : 'created'} ${idleDays.toFixed(1)}d ago, within ${this.unusedDays}d threshold`,
      );
    }
    return waste(`${secret.wasteReason}, ${idleDays.toFixed(1)}d`);
  }
}
