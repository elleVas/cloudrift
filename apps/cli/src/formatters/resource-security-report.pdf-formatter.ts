// SPDX-License-Identifier: Apache-2.0
import type { ResourceSecuritySummary } from 'resource-security-domain';
import { resourceSecurityReportFormatter } from './resource-security-report.formatter';
import type { SeverityReportPdfMeta } from './severity-report.formatter';

export type ResourceSecurityReportPdfMeta = SeverityReportPdfMeta;

export function generateResourceSecurityReportPdf(
  summary: ResourceSecuritySummary,
  meta: ResourceSecurityReportPdfMeta,
  outputPath: string,
): Promise<void> {
  return resourceSecurityReportFormatter.toPdf(summary, meta, outputPath);
}
