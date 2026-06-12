import { toWasteReportDto } from 'cloud-cost-application';
import type { WasteReportMeta } from 'cloud-cost-application';
import type { WastedResourcesSummary } from 'cloud-cost-domain';

/**
 * Proietta il summary nel WasteReportDto serializzabile: lo stesso contratto
 * dati che un futuro frontend o un endpoint HTTP esporrebbero.
 */
export function formatWasteReportAsJson(
  summary: WastedResourcesSummary,
  meta: WasteReportMeta,
): string {
  return JSON.stringify(toWasteReportDto(summary, meta), null, 2);
}
