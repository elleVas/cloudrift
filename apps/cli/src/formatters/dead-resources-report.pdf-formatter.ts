// SPDX-License-Identifier: Apache-2.0
import type { DeadResourcesSummary } from 'dead-resources-domain';
import { deadResourcesReportFormatter } from './dead-resources-report.formatter';
import type { SeverityReportPdfMeta } from './severity-report.formatter';

export type DeadResourcesReportPdfMeta = SeverityReportPdfMeta;

export function generateDeadResourcesReportPdf(
  summary: DeadResourcesSummary,
  meta: DeadResourcesReportPdfMeta,
  outputPath: string,
): Promise<void> {
  return deadResourcesReportFormatter.toPdf(summary, meta, outputPath);
}
