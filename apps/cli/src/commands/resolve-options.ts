// SPDX-License-Identifier: Apache-2.0
import { Result } from 'shared-kernel';
import { AwsRegion, DEFAULT_MIN_AGE_DAYS, RESOURCE_KINDS } from 'cloud-cost-domain';
import type { ResourceKind } from 'cloud-cost-domain';
import type { CloudriftConfig } from '../config/cloudrift.config';
import type { AnalyzeWasteOptions } from './analyze-waste.command';

/** Grace period: CLI > config > default. */
export function resolveMinAgeDays(
  options: AnalyzeWasteOptions,
  config: CloudriftConfig,
): Result<number, Error> {
  if (options.minAgeDays === undefined) {
    return Result.ok(config.minAgeDays ?? DEFAULT_MIN_AGE_DAYS);
  }
  const minAgeDays = Number(options.minAgeDays);
  if (!Number.isInteger(minAgeDays) || minAgeDays < 0) {
    return Result.fail(
      new Error(
        `--min-age-days must be a non-negative integer, got "${options.minAgeDays}".`,
      ),
    );
  }
  return Result.ok(minAgeDays);
}

/** --scanners: Result-based validation against the known RESOURCE_KINDS (no throw on bad input). */
export function resolveExplicitScanners(scanners: string[]): Result<ResourceKind[], Error> {
  const valid = new Set<string>(RESOURCE_KINDS);
  const unknown = scanners.filter((kind) => !valid.has(kind));
  if (unknown.length > 0) {
    return Result.fail(
      new Error(
        `--scanners: unknown service(s) "${unknown.join(', ')}". Valid values: ${RESOURCE_KINDS.join(', ')}.`,
      ),
    );
  }
  return Result.ok(scanners as ResourceKind[]);
}

/** Requested regions: Result-based parse (no throw on input), then exclusion from config. */
export function resolveRegions(
  options: AnalyzeWasteOptions,
  config: CloudriftConfig,
): Result<{ regions: AwsRegion[]; skipped: string[] }, Error> {
  const excluded = new Set(config.excludeRegions ?? []);
  const regions: AwsRegion[] = [];
  const skipped: string[] = [];
  for (const code of options.regions) {
    const parsed = AwsRegion.parse(code);
    if (!parsed.ok) return Result.fail(parsed.error);
    if (excluded.has(parsed.value.code)) {
      skipped.push(parsed.value.code);
      continue;
    }
    regions.push(parsed.value);
  }

  if (regions.length === 0) {
    return Result.fail(
      new Error(
        'No regions left to scan: all requested regions are listed in excludeRegions.',
      ),
    );
  }

  return Result.ok({ regions, skipped });
}
