// SPDX-License-Identifier: Apache-2.0
import { sendWebhookNotification } from './generic-webhook.notifier';
import type { NotificationSummary } from './types';

const summary: NotificationSummary = {
  title: 'cloudrift analyze — $42.10/month wasted',
  domain: 'cloud-cost',
  accountId: '123456789012',
  generatedAt: new Date('2026-07-31'),
  lines: ['3 unattached EBS volumes'],
};

describe('sendWebhookNotification', () => {
  const mockFetch = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = mockFetch;
  });

  it('POSTs the full summary as JSON', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200, statusText: 'OK' });

    const result = await sendWebhookNotification('https://example.com/hook', summary);

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      'https://example.com/hook',
      expect.objectContaining({ method: 'POST', headers: { 'Content-Type': 'application/json' } }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.title).toBe(summary.title);
    expect(body.domain).toBe('cloud-cost');
  });

  it('returns Result.fail on a non-2xx response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' });

    const result = await sendWebhookNotification('https://example.com/hook', summary);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toContain('500');
  });

  it('returns Result.fail instead of throwing on a network error', async () => {
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await sendWebhookNotification('https://example.com/hook', summary);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.message).toBe('ECONNREFUSED');
  });
});
