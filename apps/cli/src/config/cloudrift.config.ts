import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { DomainError, Result } from 'shared-kernel';

/**
 * File names searched for in the CWD, in priority order.
 */
const CONFIG_FILENAMES = ['cloudrift.config.json', '.cloudriftrc'] as const;

/** Maximum allowed CloudWatch window (7 days). */
export const MAX_CLOUDWATCH_WINDOW_HOURS = 168;

/** Maximum allowed window for CPU utilization checks (14 days). */
export const MAX_UTILIZATION_WINDOW_HOURS = 336;

/**
 * Optional configuration read from `cloudrift.config.json` or `.cloudriftrc`.
 * Every field is optional: CLI flags take precedence, then the config file,
 * then the defaults in code.
 */
export interface CloudriftConfig {
  /** Regions to exclude from the scan even if passed via -r. */
  excludeRegions?: string[];
  /** tag=value pairs that exclude a resource (e.g. { "Environment": "Production" }). */
  excludeTagValues?: Record<string, string>;
  /** Time window (hours) for "zero-activity" CloudWatch metrics (NAT, EBS idle). Default 48, max 168. */
  cloudwatchWindowHours?: number;
  /** Time window (hours) for CPU utilization checks (EC2/RDS underutilized). Default 168, max 336. */
  utilizationWindowHours?: number;
  /** Grace period in days. Overrides --min-age-days. */
  minAgeDays?: number;
  /** Explicit exclusion tag. Overrides --ignore-tag. */
  ignoreTag?: string;
  /** Monthly cost threshold: if exceeded, the command exits with code 2 (useful in CI). */
  costAlertThresholdUsd?: number;
  /**
   * Price overrides per region (special/enterprise rates). Same shape as
   * `prices.json`: `region → key → USD`, with `default` as fallback.
   * These take precedence over the static price list and the AWS Pricing API.
   */
  prices?: Record<string, Record<string, number>>;
  /** Per-check thresholds. */
  thresholds?: {
    /** Total I/O operations below which an attached EBS volume is "idle". Default 0. */
    ebsIdleMaxOps?: number;
    /** Maximum CPU (%) below which an EC2 instance is "underutilized". Default 5. */
    ec2CpuPercent?: number;
    /** Maximum CPU (%) below which an RDS instance is "underutilized". Default 5. */
    rdsCpuPercent?: number;
    /** Maximum invocations below which a Lambda function is "underutilized". Default 0. */
    lambdaInvocationsMin?: number;
    /** Total I/O bytes below which a mounted EFS file system is "idle". Default 0. */
    efsIoBytesMin?: number;
    /** Maximum RCU/WCU utilization (%) below which a DynamoDB table is "overprovisioned". Default 10. */
    dynamoCapacityUtilizationPercent?: number;
  };
}

export class ConfigError extends DomainError {
  constructor(message: string) {
    super('INVALID_CONFIG', message);
  }
}

/**
 * Loads the configuration from the CWD (or from an explicit path).
 * No file found → empty config (everything from CLI/defaults).
 */
export async function loadConfig(
  cwd: string,
  explicitPath?: string,
): Promise<Result<CloudriftConfig, ConfigError>> {
  if (explicitPath) {
    const path = resolve(cwd, explicitPath);
    const raw = await tryRead(path);
    if (raw === undefined) {
      return Result.fail(new ConfigError(`Config file not found: ${path}`));
    }
    return parseConfig(raw, path);
  }

  for (const name of CONFIG_FILENAMES) {
    const path = resolve(cwd, name);
    const raw = await tryRead(path);
    if (raw !== undefined) return parseConfig(raw, path);
  }
  return Result.ok({});
}

async function tryRead(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * Pure validation of the file content (separated from IO for testability).
 * Unknown keys are ignored (forward-compatible); known keys are
 * validated by type and the error aggregates all the problems found.
 */
export function parseConfig(
  raw: string,
  source = '<config>',
): Result<CloudriftConfig, ConfigError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return Result.fail(new ConfigError(`Config file is not valid JSON: ${source}`));
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return Result.fail(new ConfigError(`Config root must be a JSON object: ${source}`));
  }

  const obj = parsed as Record<string, unknown>;
  const config: CloudriftConfig = {};
  const errors: string[] = [];

  if (obj.excludeRegions !== undefined) {
    if (isStringArray(obj.excludeRegions)) {
      config.excludeRegions = obj.excludeRegions;
    } else {
      errors.push('excludeRegions must be an array of strings');
    }
  }

  if (obj.excludeTagValues !== undefined) {
    if (isStringRecord(obj.excludeTagValues)) {
      config.excludeTagValues = obj.excludeTagValues;
    } else {
      errors.push(
        'excludeTagValues must be an object with string values (e.g. { "Environment": "Production" })',
      );
    }
  }

  if (obj.cloudwatchWindowHours !== undefined) {
    const n = obj.cloudwatchWindowHours;
    if (typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= MAX_CLOUDWATCH_WINDOW_HOURS) {
      config.cloudwatchWindowHours = n;
    } else {
      errors.push(`cloudwatchWindowHours must be a number between 1 and ${MAX_CLOUDWATCH_WINDOW_HOURS}`);
    }
  }

  if (obj.utilizationWindowHours !== undefined) {
    const n = obj.utilizationWindowHours;
    if (typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= MAX_UTILIZATION_WINDOW_HOURS) {
      config.utilizationWindowHours = n;
    } else {
      errors.push(`utilizationWindowHours must be a number between 1 and ${MAX_UTILIZATION_WINDOW_HOURS}`);
    }
  }

  if (obj.minAgeDays !== undefined) {
    const n = obj.minAgeDays;
    if (typeof n === 'number' && Number.isInteger(n) && n >= 0) {
      config.minAgeDays = n;
    } else {
      errors.push('minAgeDays must be a non-negative integer');
    }
  }

  if (obj.ignoreTag !== undefined) {
    if (typeof obj.ignoreTag === 'string' && obj.ignoreTag.length > 0) {
      config.ignoreTag = obj.ignoreTag;
    } else {
      errors.push('ignoreTag must be a non-empty string');
    }
  }

  if (obj.costAlertThresholdUsd !== undefined) {
    const n = obj.costAlertThresholdUsd;
    if (typeof n === 'number' && Number.isFinite(n) && n >= 0) {
      config.costAlertThresholdUsd = n;
    } else {
      errors.push('costAlertThresholdUsd must be a non-negative number');
    }
  }

  if (obj.prices !== undefined) {
    if (isPriceTable(obj.prices)) {
      config.prices = obj.prices;
    } else {
      errors.push(
        'prices must be an object of region → { priceKey: number } (e.g. { "eu-west-1": { "nat-gateway": 28.5 } })',
      );
    }
  }

  if (obj.thresholds !== undefined) {
    if (!isPlainObject(obj.thresholds)) {
      errors.push('thresholds must be an object');
    } else {
      const thresholds: NonNullable<CloudriftConfig['thresholds']> = {};
      const {
        ebsIdleMaxOps,
        ec2CpuPercent,
        rdsCpuPercent,
        lambdaInvocationsMin,
        efsIoBytesMin,
        dynamoCapacityUtilizationPercent,
      } = obj.thresholds;
      if (ebsIdleMaxOps !== undefined) {
        if (typeof ebsIdleMaxOps === 'number' && Number.isFinite(ebsIdleMaxOps) && ebsIdleMaxOps >= 0) {
          thresholds.ebsIdleMaxOps = ebsIdleMaxOps;
        } else {
          errors.push('thresholds.ebsIdleMaxOps must be a non-negative number');
        }
      }
      if (ec2CpuPercent !== undefined) {
        if (
          typeof ec2CpuPercent === 'number' &&
          Number.isFinite(ec2CpuPercent) &&
          ec2CpuPercent >= 0 &&
          ec2CpuPercent <= 100
        ) {
          thresholds.ec2CpuPercent = ec2CpuPercent;
        } else {
          errors.push('thresholds.ec2CpuPercent must be a number between 0 and 100');
        }
      }
      if (rdsCpuPercent !== undefined) {
        if (
          typeof rdsCpuPercent === 'number' &&
          Number.isFinite(rdsCpuPercent) &&
          rdsCpuPercent >= 0 &&
          rdsCpuPercent <= 100
        ) {
          thresholds.rdsCpuPercent = rdsCpuPercent;
        } else {
          errors.push('thresholds.rdsCpuPercent must be a number between 0 and 100');
        }
      }
      if (lambdaInvocationsMin !== undefined) {
        if (
          typeof lambdaInvocationsMin === 'number' &&
          Number.isFinite(lambdaInvocationsMin) &&
          lambdaInvocationsMin >= 0
        ) {
          thresholds.lambdaInvocationsMin = lambdaInvocationsMin;
        } else {
          errors.push('thresholds.lambdaInvocationsMin must be a non-negative number');
        }
      }
      if (efsIoBytesMin !== undefined) {
        if (typeof efsIoBytesMin === 'number' && Number.isFinite(efsIoBytesMin) && efsIoBytesMin >= 0) {
          thresholds.efsIoBytesMin = efsIoBytesMin;
        } else {
          errors.push('thresholds.efsIoBytesMin must be a non-negative number');
        }
      }
      if (dynamoCapacityUtilizationPercent !== undefined) {
        if (
          typeof dynamoCapacityUtilizationPercent === 'number' &&
          Number.isFinite(dynamoCapacityUtilizationPercent) &&
          dynamoCapacityUtilizationPercent >= 0 &&
          dynamoCapacityUtilizationPercent <= 100
        ) {
          thresholds.dynamoCapacityUtilizationPercent = dynamoCapacityUtilizationPercent;
        } else {
          errors.push('thresholds.dynamoCapacityUtilizationPercent must be a number between 0 and 100');
        }
      }
      config.thresholds = thresholds;
    }
  }

  if (errors.length > 0) {
    return Result.fail(
      new ConfigError(`Invalid config (${source}):\n  - ${errors.join('\n  - ')}`),
    );
  }
  return Result.ok(config);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === 'string');
}

function isStringRecord(v: unknown): v is Record<string, string> {
  return (
    typeof v === 'object' &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((val) => typeof val === 'string')
  );
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isPriceTable(v: unknown): v is Record<string, Record<string, number>> {
  if (!isPlainObject(v)) return false;
  return Object.values(v).every(
    (regionPrices) =>
      isPlainObject(regionPrices) &&
      Object.values(regionPrices).every(
        (price) => typeof price === 'number' && Number.isFinite(price) && price >= 0,
      ),
  );
}
