// SPDX-License-Identifier: Apache-2.0
import type { Result } from 'shared-kernel';
import type {
  AwsRegion,
  FindWastedResourcesUseCasePort,
  ResourceKind,
  WastePolicyOptions,
} from 'cloud-cost-domain';
import { AnalyzeCloudWasteUseCase } from 'cloud-cost-application';
import { resolveAwsAccountId } from 'cloud-cost-infrastructure-aws-adapter';
import { loadConfig, type CloudriftConfig, type ConfigError } from '../config/cloudrift.config';
import { buildPricing } from './pricing.factory';
import { buildScanners } from './scanner-registry';

/** Resolved context passed to `createAnalysis` to build pricing + scanners. */
export interface AnalysisContext {
  regions: AwsRegion[];
  config: CloudriftConfig;
  accountId: string;
  livePricing: boolean;
  policyOptions: WastePolicyOptions;
  cloudwatchWindowHours: number;
  utilizationWindowHours: number;
  info: (msg: string) => void;
  /** Restrict the scan to these kinds (from --scanners, --all-services, or the wizard). Undefined runs every scanner. */
  scannerKinds?: ResourceKind[];
}

export interface Analysis {
  useCase: FindWastedResourcesUseCasePort;
  pricesAsOf: string;
  /** Releases resources held by the pricing adapter. Call after all scans complete. */
  dispose?: () => void;
}

/**
 * Injection seam: everything that touches AWS passes through here. The default
 * composes the real scanners; the CLI tests inject fakes to verify format, exit
 * code, and stdout routing without AWS credentials.
 */
export interface AnalyzeDeps {
  loadConfig(cwd: string, explicitPath?: string): Promise<Result<CloudriftConfig, ConfigError>>;
  resolveAccountId(): Promise<string | undefined>;
  createAnalysis(ctx: AnalysisContext): Promise<Analysis>;
}

/**
 * `CLOUDRIFT_SCAN_CONCURRENCY` override for `AnalyzeCloudWasteUseCase`'s
 * worker pool (see ADR-0063). Empty/unset/non-positive falls back to the
 * use case's own default (12, real-AWS-oriented) — the LocalStack e2e
 * harness (`scripts/e2e-localstack.mjs`) is the one caller that sets this.
 */
function resolveScanConcurrencyOverride(): number | undefined {
  const raw = process.env.CLOUDRIFT_SCAN_CONCURRENCY;
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/** Real composition: layered pricing + AWS scanners (one advisory, gated on --live-pricing) + generic use case. */
async function defaultCreateAnalysis(ctx: AnalysisContext): Promise<Analysis> {
  const { pricing, livePricingAdapter } = await buildPricing(ctx);
  const scanners = buildScanners(
    {
      pricing,
      accountId: ctx.accountId,
      policyOptions: ctx.policyOptions,
      cloudwatchWindowHours: ctx.cloudwatchWindowHours,
      utilizationWindowHours: ctx.utilizationWindowHours,
      config: ctx.config,
    },
    livePricingAdapter,
  );
  // No re-validation here: ctx.scannerKinds is only ever set by
  // analyze-waste.command.ts, which already validates it (--scanners against
  // RESOURCE_KINDS, or the wizard/--all-services, which can't produce an
  // unknown kind). This function has no other caller.
  const kindFilter = ctx.scannerKinds ? new Set(ctx.scannerKinds) : undefined;
  const selected = kindFilter ? scanners.filter((scanner) => kindFilter.has(scanner.kind)) : scanners;
  const concurrencyOverride = resolveScanConcurrencyOverride();
  const useCase =
    concurrencyOverride === undefined
      ? new AnalyzeCloudWasteUseCase(selected)
      : new AnalyzeCloudWasteUseCase(selected, concurrencyOverride);
  return {
    useCase,
    pricesAsOf: pricing.getPricesAsOf(),
    dispose: () => livePricingAdapter?.dispose(),
  };
}

export const defaultAnalyzeDeps: AnalyzeDeps = {
  loadConfig,
  resolveAccountId: resolveAwsAccountId,
  createAnalysis: defaultCreateAnalysis,
};
