// SPDX-License-Identifier: Apache-2.0

/**
 * Default options spread into every AWS SDK v3 client created by scanners.
 *
 * `maxAttempts: 3` enables the SDK's built-in exponential backoff with jitter,
 * handling transient throttling (429) and server errors (5xx) automatically.
 *
 * Usage:
 * ```ts
 * const ec2 = new EC2Client({ ...AWS_CLIENT_DEFAULTS, region: region.code });
 * ```
 */
export const AWS_CLIENT_DEFAULTS = { maxAttempts: 3 } as const;
