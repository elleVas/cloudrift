// SPDX-License-Identifier: Apache-2.0

/**
 * Domain-agnostic summary a caller builds from its own report DTO before
 * handing it to a notifier. Deliberately flat and free of any
 * domain-specific type (`WasteReportDto`, `SecurityFinding`, ...) so this
 * package never depends on `cloud-cost-*`/`dead-resources-*`/
 * `resource-security-*` — same "boundary DTO" reasoning as `SecurityFinding`
 * itself (ADR-0078 lineage), one level further out.
 */
export interface NotificationSummary {
  /** e.g. "cloudrift resource-security — 3 critical findings". */
  title: string;
  domain: 'cloud-cost' | 'dead-resources' | 'resource-security' | 'history';
  accountId: string;
  generatedAt: Date;
  /** Present for the three scan domains; omitted for `history` comparisons, which have their own delta framing in `lines`. */
  countBySeverity?: { critical: number; warning: number; info: number };
  /** Short, already-formatted lines — e.g. top findings, or a comparison delta. Rendered as-is (one per line/bullet) by each notifier. */
  lines: string[];
}
