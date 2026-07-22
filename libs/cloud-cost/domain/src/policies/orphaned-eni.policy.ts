// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict } from './waste-policy';
import type { OrphanedEni } from '../entities/orphaned-eni.entity';

export class OrphanedEniWastePolicy extends WastePolicy<OrphanedEni> {
  protected judge(eni: OrphanedEni): WasteVerdict {
    // ENIs do not expose a creation date: no grace period applicable.
    return eni.isOrphaned() ? waste('not attached') : notWaste('attached');
  }
}
