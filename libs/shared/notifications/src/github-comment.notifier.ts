// SPDX-License-Identifier: Apache-2.0
import { Result } from 'shared-kernel';
import type { NotificationSummary } from './types';

export interface GithubPrContext {
  token: string;
  owner: string;
  repo: string;
  prNumber: number;
}

/**
 * Markdown, not the plain text `email.notifier.ts` builds — this lands verbatim
 * in a PR's comment thread, which renders `**`/`-` natively. Includes
 * `summary.lines` in full: unlike Slack (`slack-webhook.notifier.ts`), a PR
 * comment isn't a shared ambient channel that a busy pipeline could flood, so
 * the same "wall of text" concern that keeps Slack to a title-only alert
 * doesn't apply here — the reviewer opened this PR and wants the detail.
 */
function buildCommentBody(summary: NotificationSummary): string {
  const lines = [`**${summary.title}**`, ''];
  if (summary.countBySeverity) {
    const { critical, warning, info } = summary.countBySeverity;
    lines.push(`${critical} critical, ${warning} warning, ${info} info — account \`${summary.accountId}\``, '');
  } else {
    lines.push(`Account: \`${summary.accountId}\``, '');
  }
  lines.push(...summary.lines.map((line) => `- ${line}`));
  return lines.join('\n');
}

/**
 * Posts a comment to the pull request identified by `context`, via the plain
 * GitHub REST API (no `@octokit`/`@actions/github` dependency, same
 * fetch-only style as the Slack/generic-webhook notifiers). `User-Agent` is
 * required by GitHub's API for non-browser clients; omitting it is a 403, not
 * a helpful error. Same never-throws, best-effort contract as every other
 * notifier here — a broken token or a deleted PR must never fail the scan.
 */
export async function sendGithubPrComment(context: GithubPrContext, summary: NotificationSummary): Promise<Result<void>> {
  try {
    const response = await fetch(`https://api.github.com/repos/${context.owner}/${context.repo}/issues/${context.prNumber}/comments`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${context.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
        'User-Agent': 'cloudrift-cli',
      },
      body: JSON.stringify({ body: buildCommentBody(summary) }),
    });
    if (!response.ok) {
      return Result.fail(new Error(`GitHub API returned ${response.status} ${response.statusText}`));
    }
    return Result.ok(undefined);
  } catch (err) {
    return Result.fail(err instanceof Error ? err : new Error(String(err)));
  }
}
