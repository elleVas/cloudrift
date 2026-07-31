// SPDX-License-Identifier: Apache-2.0
import { Result } from 'shared-kernel';
import type { NotificationSummary } from './types';

/**
 * Posts the full `NotificationSummary` as JSON to an arbitrary URL — the
 * "bring your own integration" escape hatch for services cloudrift doesn't
 * have a dedicated notifier for (Teams, Discord, an internal ops endpoint,
 * ...). Same never-throws contract as the Slack notifier.
 */
export async function sendWebhookNotification(url: string, summary: NotificationSummary): Promise<Result<void>> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(summary),
    });
    if (!response.ok) {
      return Result.fail(new Error(`Webhook returned ${response.status} ${response.statusText}`));
    }
    return Result.ok(undefined);
  } catch (err) {
    return Result.fail(err instanceof Error ? err : new Error(String(err)));
  }
}
