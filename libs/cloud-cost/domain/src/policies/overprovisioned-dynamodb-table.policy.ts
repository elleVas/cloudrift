// SPDX-License-Identifier: Apache-2.0
import { WastePolicy, notWaste, waste, type WasteVerdict, type WastePolicyOptions } from './waste-policy';
import type { OverprovisionedDynamoDbTable } from '../entities/overprovisioned-dynamodb-table.entity';

export class DynamoDbOverprovisionedPolicy extends WastePolicy<OverprovisionedDynamoDbTable> {
  /** maxUtilizationPercent: maximum utilization threshold (read and write) below which the table is overprovisioned. */
  constructor(options: WastePolicyOptions = {}, private readonly maxUtilizationPercent = 10) {
    super(options);
  }

  protected judge(table: OverprovisionedDynamoDbTable, now: Date): WasteVerdict {
    if (
      table.avgReadUtilizationPercent >= this.maxUtilizationPercent ||
      table.avgWriteUtilizationPercent >= this.maxUtilizationPercent
    ) {
      return notWaste('utilization above threshold');
    }
    // A just-created table might not have accumulated real traffic yet.
    if (this.isWithinGracePeriod(table.creationDateTime, now)) {
      return notWaste(`created less than ${this.minAgeDays}d ago`);
    }
    return waste(
      `read ${table.avgReadUtilizationPercent.toFixed(1)}% / write ${table.avgWriteUtilizationPercent.toFixed(1)}% over ${table.windowDays}d`,
    );
  }
}
