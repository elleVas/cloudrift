// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict, type WastePolicyOptions } from './waste-policy';
import type { Workspace } from '../entities/workspace.entity';

export class WorkspacesIdlePolicy extends WastePolicy<Workspace> {
  /** windowDays: days since the last user connection below which an AlwaysOn WorkSpace is "idle". */
  constructor(options: WastePolicyOptions = {}, private readonly windowDays = 30) {
    super(options);
  }

  protected judge(workspace: Workspace, now: Date): WasteVerdict {
    return workspace.isIdle(now, this.windowDays)
      ? waste(workspace.wasteReason)
      : notWaste('user connected within the window');
  }
}
