import chalk from 'chalk';
import { resolve } from 'path';
import { writeFile } from 'fs/promises';
import {
  AwsRegion,
  EbsVolumeWastePolicy,
  ElasticIpWastePolicy,
  RdsInstanceWastePolicy,
  LoadBalancerWastePolicy,
  Ec2InstanceWastePolicy,
  EbsSnapshotWastePolicy,
  NatGatewayWastePolicy,
} from 'cloud-cost-domain';
import type { WastePolicyOptions, WasteScannerPort } from 'cloud-cost-domain';
import { AnalyzeCloudWasteUseCase } from 'cloud-cost-application';
import type { WasteReportMeta } from 'cloud-cost-application';
import {
  AwsEbsVolumeScanner,
  AwsElasticIpScanner,
  AwsRdsInstanceScanner,
  AwsLoadBalancerScanner,
  AwsEc2InstanceScanner,
  AwsEbsSnapshotScanner,
  AwsNatGatewayScanner,
  StaticPriceTableAdapter,
  resolveAwsAccountId,
} from 'cloud-cost-infrastructure-aws-adapter';
import { formatWasteReportAsTable } from '../formatters/waste-report.table-formatter';
import { formatWasteReportAsJson } from '../formatters/waste-report.json-formatter';
import { generateWasteReportPdf } from '../formatters/waste-report.pdf-formatter';

interface AnalyzeWasteOptions {
  regions: string[];
  accountId?: string;
  pdf?: string | boolean;
  json?: string | boolean;
  minAgeDays: string;
  ignoreTag: string;
}

function fail(message: string): void {
  console.error(chalk.red(`\n  Error: ${message}\n`));
  process.exitCode = 1;
}

/**
 * Composition root: l'unico punto dove le implementazioni concrete (scanner
 * AWS, listino prezzi) vengono istanziate e iniettate nel use case.
 */
export async function analyzeWasteCommand(
  options: AnalyzeWasteOptions,
): Promise<void> {
  const regions: AwsRegion[] = [];
  for (const code of options.regions) {
    const parsed = AwsRegion.parse(code);
    if (!parsed.ok) return fail(parsed.error.message);
    regions.push(parsed.value);
  }

  const minAgeDays = Number(options.minAgeDays);
  if (!Number.isInteger(minAgeDays) || minAgeDays < 0) {
    return fail(`--min-age-days must be a non-negative integer, got "${options.minAgeDays}".`);
  }

  // --json senza filename: stampa solo JSON su stdout (output machine-readable).
  const jsonToStdout = options.json === true;

  const accountId = options.accountId ?? (await resolveAwsAccountId()) ?? 'unknown';

  if (!jsonToStdout) {
    const accountLabel = accountId !== 'unknown' ? ` (account ${accountId})` : '';
    console.log(
      chalk.bold.blue(
        `\n  Scanning ${regions.map((r) => r.code).join(', ')}${accountLabel} for wasted cloud resources...\n`,
      ),
    );
  }

  const pricing = new StaticPriceTableAdapter();
  const policyOptions: WastePolicyOptions = {
    minAgeDays,
    ignoreTag: options.ignoreTag,
  };

  const scanners: WasteScannerPort[] = [
    new AwsEbsVolumeScanner(pricing, accountId, new EbsVolumeWastePolicy(policyOptions)),
    new AwsElasticIpScanner(pricing, accountId, new ElasticIpWastePolicy(policyOptions)),
    new AwsRdsInstanceScanner(pricing, accountId, new RdsInstanceWastePolicy(policyOptions)),
    new AwsLoadBalancerScanner(pricing, accountId, new LoadBalancerWastePolicy(policyOptions)),
    new AwsEc2InstanceScanner(pricing, accountId, new Ec2InstanceWastePolicy(policyOptions)),
    new AwsEbsSnapshotScanner(pricing, accountId, new EbsSnapshotWastePolicy(policyOptions)),
    new AwsNatGatewayScanner(pricing, accountId, new NatGatewayWastePolicy(policyOptions)),
  ];

  const useCase = new AnalyzeCloudWasteUseCase(scanners);
  const result = await useCase.execute({ regions });

  if (!result.ok) return fail(result.error.message);

  const meta: WasteReportMeta = {
    accountId,
    regions: regions.map((r) => r.code),
    generatedAt: new Date(),
    pricesAsOf: pricing.getPricesAsOf(),
  };

  if (jsonToStdout) {
    console.log(formatWasteReportAsJson(result.value, meta));
  } else {
    console.log(formatWasteReportAsTable(result.value, meta));
  }

  if (typeof options.json === 'string') {
    const jsonPath = resolve(process.cwd(), options.json);
    await writeFile(jsonPath, formatWasteReportAsJson(result.value, meta));
    console.log(chalk.green(`  JSON report saved to ${jsonPath}\n`));
  }

  if (options.pdf !== undefined && options.pdf !== false) {
    const filename =
      typeof options.pdf === 'string'
        ? options.pdf
        : `cloudrift-report-${new Date().toISOString().split('T')[0]}.pdf`;
    const outputPath = resolve(process.cwd(), filename);

    process.stdout.write(chalk.bold(`  Generating PDF report...`));
    await generateWasteReportPdf(result.value, meta, outputPath);
    console.log(chalk.green(` saved to ${outputPath}\n`));
  }
}
