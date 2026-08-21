// SPDX-License-Identifier: Apache-2.0
import chalk from 'chalk';
import { readFileSync } from 'node:fs';
import type { GithubPrContext, NotificationSummary, SmtpConfig } from 'shared-notifications';
import { sendSlackNotification, sendWebhookNotification, sendEmailNotification, sendGithubPrComment } from 'shared-notifications';

export interface NotifyFlags {
  notifySlack?: boolean;
  notifyWebhook?: boolean;
  notifyEmail?: string;
  notifyGithubComment?: boolean;
  /**
   * Set only by the interactive wizard: a human explicitly asked to email
   * *this* report, the same "want a PDF too?" kind of one-off choice — not
   * an automated alert, so it must fire regardless of the severity/cost/
   * regression gate each command checks before calling `dispatchNotifications`.
   * `--notify-email` from a flag (CI/scripts) has no way to set this and
   * stays gated, same as `--notify-slack`/`--notify-webhook`.
   */
  notifyEmailIgnoresGate?: boolean;
}

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, info: 2 };

/** Most-severe-first, capped to `limit` — same shape as the PDF's "top findings" list, reused here for the notification body. */
export function topFindingLines<T extends { kind: string; severity: string }>(
  findings: readonly T[],
  reasonFor: (finding: T) => string,
  limit = 5,
): string[] {
  return [...findings]
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99))
    .slice(0, limit)
    .map((finding) => `${finding.kind}: ${reasonFor(finding)} (${finding.severity})`);
}

/**
 * Every channel's config comes from the environment, never from a CLI flag —
 * a webhook URL or SMTP password would otherwise land in shell history and
 * `ps aux`, the same reasoning that keeps AWS credentials out of flags too.
 * Flags only turn a channel *on*; `--notify-email <address>` is the one
 * exception because a recipient address isn't a secret.
 */
function resolveSmtpConfig(): SmtpConfig | undefined {
  const host = process.env.CLOUDRIFT_SMTP_HOST;
  const port = process.env.CLOUDRIFT_SMTP_PORT;
  const user = process.env.CLOUDRIFT_SMTP_USER;
  const password = process.env.CLOUDRIFT_SMTP_PASSWORD;
  const from = process.env.CLOUDRIFT_SMTP_FROM;
  if (!host || !port || !user || !password || !from) return undefined;
  return { host, port: Number(port), user, password, from };
}

/**
 * `GITHUB_TOKEN`/`GITHUB_REPOSITORY` are only two of three needed pieces:
 * unlike a Slack/webhook URL, the PR number isn't a static secret to put in
 * an env var — it's read from the triggering event's own payload
 * (`GITHUB_EVENT_PATH`, `pull_request.number`), the documented, stable
 * source (as opposed to parsing `GITHUB_REF`'s `refs/pull/<n>/merge`, which
 * happens to work but isn't the contract). Also `GITHUB_TOKEN` — unlike
 * `GITHUB_REPOSITORY`/`GITHUB_EVENT_PATH` — is not exported by Actions by
 * default; the workflow must forward it explicitly (`env: GITHUB_TOKEN:
 * ${{ github.token }}`), so its absence commonly just means the user hasn't
 * wired that up yet, not a broken environment.
 */
function resolveGithubPrContext(): GithubPrContext | undefined {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  const eventPath = process.env.GITHUB_EVENT_PATH;
  if (!token || !repository || !eventPath) return undefined;

  const [owner, repo] = repository.split('/');
  if (!owner || !repo) return undefined;

  try {
    const event = JSON.parse(readFileSync(eventPath, 'utf8'));
    const prNumber = event.pull_request?.number;
    if (typeof prNumber !== 'number') return undefined;
    return { token, owner, repo, prNumber };
  } catch {
    return undefined;
  }
}

/**
 * Fans out to every channel the caller turned on via `flags`, resolving each
 * channel's config from the environment. Best-effort throughout: a missing
 * env var or a failed send is logged via `info` (stderr in machine-readable
 * modes, same as every other warning in this CLI) and never throws — a
 * broken webhook must never fail the scan it's reporting on.
 */
export async function dispatchNotifications(flags: NotifyFlags, summary: NotificationSummary, info: (msg: string) => void): Promise<void> {
  const tasks: Promise<void>[] = [];

  if (flags.notifySlack) {
    const url = process.env.SLACK_WEBHOOK_URL;
    if (!url) {
      info(chalk.yellow('  --notify-slack was set but SLACK_WEBHOOK_URL is not — skipping the Slack notification.'));
    } else {
      tasks.push(
        sendSlackNotification(url, summary).then((result) => {
          if (!result.ok) info(chalk.yellow(`  Slack notification failed: ${result.error.message}`));
          else info(chalk.green('  Slack notification sent.'));
        }),
      );
    }
  }

  if (flags.notifyWebhook) {
    const url = process.env.CLOUDRIFT_WEBHOOK_URL;
    if (!url) {
      info(chalk.yellow('  --notify-webhook was set but CLOUDRIFT_WEBHOOK_URL is not — skipping the webhook notification.'));
    } else {
      tasks.push(
        sendWebhookNotification(url, summary).then((result) => {
          if (!result.ok) info(chalk.yellow(`  Webhook notification failed: ${result.error.message}`));
          else info(chalk.green('  Webhook notification sent.'));
        }),
      );
    }
  }

  if (flags.notifyEmail) {
    const smtp = resolveSmtpConfig();
    if (!smtp) {
      info(chalk.yellow('  --notify-email was set but CLOUDRIFT_SMTP_HOST/PORT/USER/PASSWORD/FROM are not all set — skipping the email notification.'));
    } else {
      const to = flags.notifyEmail;
      tasks.push(
        sendEmailNotification(smtp, to, summary).then((result) => {
          if (!result.ok) info(chalk.yellow(`  Email notification failed: ${result.error.message}`));
          else info(chalk.green(`  Email notification sent to ${to}.`));
        }),
      );
    }
  }

  if (flags.notifyGithubComment) {
    const context = resolveGithubPrContext();
    if (!context) {
      info(
        chalk.yellow(
          '  --notify-github-comment was set but GITHUB_TOKEN/GITHUB_REPOSITORY/GITHUB_EVENT_PATH are not all set, or this run is not a pull_request event — skipping the PR comment.',
        ),
      );
    } else {
      tasks.push(
        sendGithubPrComment(context, summary).then((result) => {
          if (!result.ok) info(chalk.yellow(`  GitHub PR comment failed: ${result.error.message}`));
          else info(chalk.green('  GitHub PR comment posted.'));
        }),
      );
    }
  }

  await Promise.all(tasks);
}
