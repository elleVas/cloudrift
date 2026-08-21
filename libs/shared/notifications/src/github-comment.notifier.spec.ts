// SPDX-License-Identifier: Apache-2.0
import { sendGithubPrComment } from './github-comment.notifier';
import type { NotificationSummary } from './types';

const summary: NotificationSummary = {
  title: 'cloudrift analyze — $123.45/mo wasted (account 123456789012)',
  domain: 'cloud-cost',
  accountId: '123456789012',
  generatedAt: new Date('2026-08-21'),
  lines: ['ec2-instance-stopped: stopped for 45 days ($30.00/mo)', 'ebs-volume-unattached: unattached ($5.00/mo)'],
};

const context = { token: 'ghs_x', owner: 'elleVas', repo: 'cloudrift', prNumber: 42 };

function postedBody(mockFetch: jest.Mock) {
  return JSON.parse(mockFetch.mock.calls[0][1].body).body as string;
}

describe('sendGithubPrComment', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;
    mockFetch.mockResolvedValue({ ok: true, status: 201, statusText: 'Created' });
  });

  it('posts to the issues/comments endpoint for the given owner/repo/PR', async () => {
    const result = await sendGithubPrComment(context, summary);

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.github.com/repos/elleVas/cloudrift/issues/42/comments',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer ghs_x',
          Accept: 'application/vnd.github+json',
          'User-Agent': 'cloudrift-cli',
        }),
      }),
    );
  });

  it('includes the title (bolded) and every line, unlike the Slack notifier', async () => {
    await sendGithubPrComment(context, summary);

    const body = postedBody(mockFetch);
    expect(body).toContain(`**${summary.title}**`);
    expect(body).toContain('ec2-instance-stopped: stopped for 45 days ($30.00/mo)');
    expect(body).toContain('ebs-volume-unattached: unattached ($5.00/mo)');
  });

  it('renders severity counts when present', async () => {
    await sendGithubPrComment(context, { ...summary, domain: 'resource-security', countBySeverity: { critical: 2, warning: 1, info: 0 } });

    expect(postedBody(mockFetch)).toContain('2 critical, 1 warning, 0 info — account `123456789012`');
  });

  it('falls back to a plain account line when there is no severity concept', async () => {
    await sendGithubPrComment(context, summary);

    expect(postedBody(mockFetch)).toContain('Account: `123456789012`');
  });

  it('returns Result.fail when the GitHub API responds with a non-2xx status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });

    const result = await sendGithubPrComment(context, summary);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('404');
  });

  it('returns Result.fail instead of throwing on a network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ENOTFOUND'));

    const result = await sendGithubPrComment(context, summary);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('ENOTFOUND');
  });
});
