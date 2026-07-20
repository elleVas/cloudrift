// SPDX-License-Identifier: Apache-2.0
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { z } from 'zod';
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
    /** Maximum peak-to-Min-ACU ratio (%) below which an Aurora Serverless v2 Min ACU floor is "overprovisioned". Default 50. */
    auroraMinAcuUtilizationPercent?: number;
    /** Maximum CPU (%) below which an InService SageMaker notebook instance is "idle". Default 2. */
    sagemakerNotebookCpuPercent?: number;
    /** Maximum CPU-requested-to-allocatable ratio (%) below which an EKS node group is "overprovisioned". Default 30. */
    eksNodeUtilizationPercent?: number;
  };
  /** Dev/PR "ghost environment" detection (environment-ghost scanner). */
  environmentDetection?: {
    /** Tag keys checked, in priority order, to group resources into an environment. Default ["Environment", "env", "branch"]. */
    tagKeys?: string[];
    /** Glob naming-convention fallback for resources with no matching tag. Default ["*-pr-*", "*-preview-*", "*-dev-*", "*-feat-*"]. */
    namingPatterns?: string[];
    /** Days every resource in a group must look inactive before the group is "ghost". Default 7. */
    inactivityDays?: number;
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

const nonNegativeAmount = z.number().finite().nonnegative();
const percent = z.number().finite().min(0).max(100);
const priceTableSchema = z.record(z.string(), z.record(z.string(), nonNegativeAmount));

const configSchema = z.object({
  excludeRegions: z.array(z.string()).optional(),
  excludeTagValues: z.record(z.string(), z.string()).optional(),
  cloudwatchWindowHours: z.number().finite().positive().max(MAX_CLOUDWATCH_WINDOW_HOURS).optional(),
  utilizationWindowHours: z.number().finite().positive().max(MAX_UTILIZATION_WINDOW_HOURS).optional(),
  minAgeDays: z.number().int().nonnegative().optional(),
  ignoreTag: z.string().min(1).optional(),
  costAlertThresholdUsd: nonNegativeAmount.optional(),
  prices: priceTableSchema.optional(),
  thresholds: z
    .object({
      ebsIdleMaxOps: nonNegativeAmount.optional(),
      ec2CpuPercent: percent.optional(),
      rdsCpuPercent: percent.optional(),
      lambdaInvocationsMin: nonNegativeAmount.optional(),
      efsIoBytesMin: nonNegativeAmount.optional(),
      dynamoCapacityUtilizationPercent: percent.optional(),
      auroraMinAcuUtilizationPercent: percent.optional(),
      sagemakerNotebookCpuPercent: percent.optional(),
      eksNodeUtilizationPercent: percent.optional(),
    })
    .optional(),
  environmentDetection: z
    .object({
      tagKeys: z.array(z.string().min(1)).optional(),
      namingPatterns: z.array(z.string().min(1)).optional(),
      inactivityDays: z.number().int().nonnegative().optional(),
    })
    .optional(),
}) satisfies z.ZodType<CloudriftConfig, unknown>;

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

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    const errors = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    return Result.fail(new ConfigError(`Invalid config (${source}):\n  - ${errors.join('\n  - ')}`));
  }
  return Result.ok(result.data);
}
