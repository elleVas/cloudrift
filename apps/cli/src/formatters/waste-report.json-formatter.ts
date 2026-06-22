import { toWasteReportDto } from 'cloud-cost-application';
import type { WasteReportMeta } from 'cloud-cost-application';
import type { WastedResourcesSummary } from 'cloud-cost-domain';

/**
 * Projects the summary into the serializable WasteReportDto: the same data
 * contract a future frontend or HTTP endpoint would expose.
 */
export function formatWasteReportAsJson(
  summary: WastedResourcesSummary,
  meta: WasteReportMeta,
): string {
  return JSON.stringify(toWasteReportDto(summary, meta), null, 2);
}
