// SPDX-License-Identifier: Apache-2.0
import { Result } from 'shared-kernel';
import type { NotificationSummary } from './types';

/**
 * Same fixed status palette as `history-report.html-formatter.ts`'s
 * `--severity-critical`/`--severity-warning`/info-as-muted — never themed,
 * kept identical across every surface that shows a severity so a "critical"
 * finding looks the same shade of red everywhere in cloudrift.
 */
const SEVERITY_COLOR = { critical: '#d03b3b', warning: '#fab219', info: '#898781' } as const;

/** No severity concept for cost-waste/regression alerts (`analyze`, cost-based `history --compare`) — treat as "worth a second look," same weight as `warning`. */
const DEFAULT_COLOR = SEVERITY_COLOR.warning;

function pickColor(countBySeverity: NotificationSummary['countBySeverity']): string {
  if (!countBySeverity) return DEFAULT_COLOR;
  if (countBySeverity.critical > 0) return SEVERITY_COLOR.critical;
  if (countBySeverity.warning > 0) return SEVERITY_COLOR.warning;
  return SEVERITY_COLOR.info;
}

/**
 * Posts to a Slack "Incoming Webhook" URL using a colored "attachment" (the
 * classic mechanism Slack integrations have used for status-colored alerts
 * for years — a vertical bar in `color`, alongside `text`) rather than the
 * bare top-level `text` field. Deliberately just `summary.title` in bold —
 * every command builds it to already carry domain, counts/amount, and
 * account (see e.g. `resource-security.command.ts`), so nothing else is
 * needed. Earlier versions also rendered `summary.lines` (the top findings)
 * here, but that treated Slack as a mini-report instead of an alert: fine
 * for a single manual run, but on a scheduled pipeline scanning several
 * accounts/regions it turns into an unbounded wall of text per run.
 * `lines` is still populated and sent as-is to the generic webhook and
 * email notifiers, where a machine consumer or a personal inbox can handle
 * the extra detail without cluttering a shared channel — only Slack's own
 * rendering dropped it. Bold markdown is safe here specifically because the
 * title is a fixed format string built from numbers/enum-like domain
 * names — never free-text from a finding, which is what made `*`/`_`/`~`
 * inside `summary.lines` dangerous (Slack's mrkdwn parser eats a `*...*`
 * pair as bold; confirmed live against a real webhook that this happened
 * with an IAM wildcard policy's `Action: "*"`, and that neither `mrkdwn:
 * false` nor fullwidth-Unicode substitution reliably prevented it). Never
 * throws: network/HTTP failures are returned as `Result.fail` so callers
 * can log-and-continue (this channel is always best-effort, never allowed
 * to fail the scan itself).
 */
export async function sendSlackNotification(webhookUrl: string, summary: NotificationSummary): Promise<Result<void>> {
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        attachments: [{ color: pickColor(summary.countBySeverity), text: `*${summary.title}*`, mrkdwn_in: ['text'] }],
      }),
    });
    if (!response.ok) {
      return Result.fail(new Error(`Slack webhook returned ${response.status} ${response.statusText}`));
    }
    return Result.ok(undefined);
  } catch (err) {
    return Result.fail(err instanceof Error ? err : new Error(String(err)));
  }
}
