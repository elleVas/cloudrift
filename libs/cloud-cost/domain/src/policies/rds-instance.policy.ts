// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { RdsInstance } from '../entities/rds-instance.entity';

export class RdsInstanceWastePolicy extends WastePolicy<RdsInstance> {
  protected judge(db: RdsInstance): WasteVerdict {
    // AWS automatically restarts a stopped instance after 7 days: if we see it
    // stopped it is by definition recent, so the grace period does not apply.
    return db.isStopped()
      ? waste('stopped (storage and backups still billed)')
      : notWaste('not stopped');
  }
}
