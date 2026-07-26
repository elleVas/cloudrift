// SPDX-License-Identifier: Apache-2.0
import type { DeadResourcesSummary } from 'dead-resources-domain';
import { deadResourcesReportFormatter } from './dead-resources-report.formatter';

export function formatDeadResourcesReportAsTable(summary: DeadResourcesSummary): string {
  return deadResourcesReportFormatter.toTable(summary);
}
