// SPDX-License-Identifier: Apache-2.0
export interface Logger {
  /** No-op unless the namespace matches `DEBUG` (e.g. `DEBUG=cloudrift:*`). */
  debug(message: string, meta?: Record<string, unknown>): void;
}

function parsePatterns(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

function matches(namespace: string, patterns: string[]): boolean {
  return patterns.some((p) => {
    if (p === '*') return true;
    if (p.endsWith('*')) return namespace.startsWith(p.slice(0, -1));
    return p === namespace;
  });
}

/**
 * Minimal `debug`-style logger: no dependency, no transport config. Enabled
 * per-namespace via the `DEBUG` env var (comma-separated, `*` wildcard),
 * e.g. `DEBUG=cloudrift:* cloudrift analyze`. Writes to stderr so it never
 * mixes with stdout report output (tables/JSON/PDF).
 */
export function createLogger(namespace: string): Logger {
  const enabled = matches(namespace, parsePatterns(process.env.DEBUG));
  return {
    debug(message, meta) {
      if (!enabled) return;
      const suffix = meta ? ` ${JSON.stringify(meta)}` : '';
      process.stderr.write(`${namespace} ${message}${suffix}\n`);
    },
  };
}
