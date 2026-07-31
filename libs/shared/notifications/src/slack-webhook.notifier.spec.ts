// SPDX-License-Identifier: Apache-2.0
import { sendSlackNotification } from './slack-webhook.notifier';
import type { NotificationSummary } from './types';

const summary: NotificationSummary = {
  title: 'cloudrift resource-security — 2 critical, 1 warning, 0 info (account 123456789012)',
  domain: 'resource-security',
  accountId: '123456789012',
  generatedAt: new Date('2026-07-31'),
  countBySeverity: { critical: 2, warning: 1, info: 0 },
  lines: ['S3 bucket "my-bucket" is public', 'Root account has no MFA'],
};

async function postedAttachment(mockFetch: jest.Mock) {
  const body = JSON.parse(mockFetch.mock.calls[0][1].body);
  return body.attachments[0];
}

describe('sendSlackNotification', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;
    mockFetch.mockResolvedValue({ ok: true, status: 200, statusText: 'OK' });
  });

  it('posts the title, bolded, as a single colored attachment — no per-finding detail', async () => {
    const result = await sendSlackNotification('https://hooks.slack.com/services/x', summary);

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://hooks.slack.com/services/x',
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } }),
    );
    const attachment = await postedAttachment(mockFetch);
    expect(attachment.text).toBe(`*${summary.title}*`);
    expect(attachment.mrkdwn_in).toEqual(['text']);
  });

  it('never leaks summary.lines into the Slack message, regardless of content', async () => {
    const wildcardSummary: NotificationSummary = {
      ...summary,
      lines: ['iam-user-policy-wildcard: grants Action: "*", Resource: "*" (critical)'],
    };

    await sendSlackNotification('https://hooks.slack.com/services/x', wildcardSummary);

    const attachment = await postedAttachment(mockFetch);
    expect(attachment.text).toBe(`*${wildcardSummary.title}*`);
    expect(attachment.text).not.toContain('iam-user-policy-wildcard');
  });

  it('colors the attachment red when there is at least one critical finding', async () => {
    await sendSlackNotification('https://hooks.slack.com/services/x', { ...summary, countBySeverity: { critical: 1, warning: 5, info: 0 } });

    expect((await postedAttachment(mockFetch)).color).toBe('#d03b3b');
  });

  it('colors the attachment amber when there are warnings but no criticals', async () => {
    await sendSlackNotification('https://hooks.slack.com/services/x', { ...summary, countBySeverity: { critical: 0, warning: 3, info: 0 } });

    expect((await postedAttachment(mockFetch)).color).toBe('#fab219');
  });

  it('colors the attachment muted grey when only info findings are present', async () => {
    await sendSlackNotification('https://hooks.slack.com/services/x', { ...summary, countBySeverity: { critical: 0, warning: 0, info: 2 } });

    expect((await postedAttachment(mockFetch)).color).toBe('#898781');
  });

  it('defaults to the amber color for summaries with no severity concept (e.g. cost-waste)', async () => {
    await sendSlackNotification('https://hooks.slack.com/services/x', { ...summary, countBySeverity: undefined });

    expect((await postedAttachment(mockFetch)).color).toBe('#fab219');
  });

  it('returns Result.fail when Slack responds with a non-2xx status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });

    const result = await sendSlackNotification('https://hooks.slack.com/services/x', summary);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('404');
  });

  it('returns Result.fail instead of throwing on a network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ENOTFOUND'));

    const result = await sendSlackNotification('https://hooks.slack.com/services/x', summary);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('ENOTFOUND');
  });
});
