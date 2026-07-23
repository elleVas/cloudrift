// SPDX-License-Identifier: Apache-2.0
// Deliberately separate text from `cloud-cost-application`'s
// `REPORT_DISCLAIMER`/`COST_REPORT_DISCLAIMER` (ADR-0078): this domain has
// no cost estimates to caveat, and talks about hygiene findings, not waste.
export const DEAD_RESOURCES_REPORT_DISCLAIMER =
  'cloudrift is a read-only analysis tool: it reports hygiene findings and recommendations ' +
  'only — it never deletes, modifies, or stops any AWS resource. All findings should be ' +
  'validated by your infrastructure/security team before taking action. The maintainers ' +
  'assume no liability for actions taken based on this report.';
