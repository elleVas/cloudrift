// SPDX-License-Identifier: Apache-2.0
import type { Result } from 'shared-kernel';
import type { CostExplorerPort } from 'cloud-cost-domain';
import {
  AwsCostExplorerAdapter,
  CachedCostExplorerAdapter,
  resolveAwsAccountId,
} from 'cloud-cost-infrastructure-aws-adapter';
import { loadConfig, type CloudriftConfig, type ConfigError } from '../config/cloudrift.config';

/**
 * Injection seam for `cost`/`trend`, mirroring `AnalyzeDeps`
 * (`analyze-waste.composition.ts`): everything that touches AWS passes
 * through here so command tests can inject a fake `CostExplorerPort`
 * without credentials.
 */
export interface CostAnalyticsDeps {
  loadConfig(cwd: string, explicitPath?: string): Promise<Result<CloudriftConfig, ConfigError>>;
  resolveAccountId(): Promise<string | undefined>;
  createCostExplorer(accountId: string, refreshCache: boolean): CostExplorerPort;
}

export const defaultCostAnalyticsDeps: CostAnalyticsDeps = {
  loadConfig,
  resolveAccountId: resolveAwsAccountId,
  createCostExplorer: (accountId, refreshCache) =>
    new CachedCostExplorerAdapter(new AwsCostExplorerAdapter(), accountId, { refresh: refreshCache }),
};
