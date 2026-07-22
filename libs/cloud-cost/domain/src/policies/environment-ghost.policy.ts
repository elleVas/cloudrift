// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict, type WastePolicyOptions } from './waste-policy';
import type { EnvironmentGhost } from '../entities/environment-ghost.entity';

export class EnvironmentGhostPolicy extends WastePolicy<EnvironmentGhost> {
  /** inactivityDays: how long every resource in the group must have looked inactive before the group is "ghost". Default 7 — distinct from `minAgeDays`, which the base class's grace period does not apply here (there is no single "creation date" for a heterogeneous group). */
  constructor(options: WastePolicyOptions = {}, private readonly inactivityDays = 7) {
    super(options);
  }

  protected judge(env: EnvironmentGhost, now: Date): WasteVerdict {
    if (env.resourceCount === 0) {
      return notWaste('no evaluable resources in group (unsupported types only)');
    }
    if (env.inactiveResourceCount < env.resourceCount) {
      return notWaste('at least one resource still active');
    }
    const idleDays = this.ageInDays(env.lastActivityTimestamp, now);
    if (idleDays < this.inactivityDays) {
      return notWaste(`inactive ${idleDays.toFixed(1)}d, within ${this.inactivityDays}d threshold`);
    }
    return waste(
      `${env.resourceCount} resource(s) (${env.resourceTypes.join(', ')}) inactive for ${idleDays.toFixed(1)}d`,
    );
  }
}
