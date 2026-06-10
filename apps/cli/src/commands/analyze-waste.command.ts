import chalk from 'chalk';
import { resolve } from 'path';
import { AwsRegion } from 'cloud-cost-domain';
import { AnalyzeCloudWasteUseCase } from 'cloud-cost-application';
import {
  AwsEbsVolumeRepositoryAdapter,
  AwsElasticIpRepositoryAdapter,
  AwsRdsInstanceRepositoryAdapter,
  AwsLoadBalancerRepositoryAdapter,
  AwsEc2InstanceRepositoryAdapter,
  AwsEbsSnapshotRepositoryAdapter,
  AwsNatGatewayRepositoryAdapter,
  StaticPriceTableAdapter,
} from 'cloud-cost-infrastructure-aws-adapter';
import { formatWasteReportAsTable } from '../formatters/waste-report.table-formatter';
import { generateWasteReportPdf } from '../formatters/waste-report.pdf-formatter';

interface AnalyzeWasteOptions {
  regions: string[];
  accountId: string;
  pdf?: string | boolean;
}

export async function analyzeWasteCommand(
  options: AnalyzeWasteOptions,
): Promise<void> {
  const regions = options.regions.map(AwsRegion.create);
  const { accountId } = options;

  const accountLabel = accountId !== 'unknown' ? ` (account ${accountId})` : '';
  console.log(
    chalk.bold.blue(
      `\n  Scanning ${regions.map((r) => r.code).join(', ')}${accountLabel} for wasted cloud resources...\n`,
    ),
  );

  const pricing = new StaticPriceTableAdapter();

  const useCase = new AnalyzeCloudWasteUseCase({
    ebsRepository: new AwsEbsVolumeRepositoryAdapter(pricing, accountId),
    elasticIpRepository: new AwsElasticIpRepositoryAdapter(pricing, accountId),
    rdsRepository: new AwsRdsInstanceRepositoryAdapter(pricing, accountId),
    loadBalancerRepository: new AwsLoadBalancerRepositoryAdapter(pricing, accountId),
    ec2Repository: new AwsEc2InstanceRepositoryAdapter(pricing, accountId),
    snapshotRepository: new AwsEbsSnapshotRepositoryAdapter(pricing, accountId),
    natGatewayRepository: new AwsNatGatewayRepositoryAdapter(pricing, accountId),
  });

  const result = await useCase.execute({ regions });

  if (!result.ok) {
    console.error(chalk.red(`\n  Error: ${result.error.message}\n`));
    process.exit(1);
  }

  console.log(formatWasteReportAsTable(result.value));

  if (options.pdf !== undefined && options.pdf !== false) {
    const filename =
      typeof options.pdf === 'string'
        ? options.pdf
        : `cloudrift-report-${new Date().toISOString().split('T')[0]}.pdf`;
    const outputPath = resolve(process.cwd(), filename);

    process.stdout.write(chalk.bold(`  Generating PDF report...`));
    await generateWasteReportPdf(result.value, {
      accountId,
      regions: regions.map((r) => r.code),
      generatedAt: new Date(),
    }, outputPath);
    console.log(chalk.green(` saved to ${outputPath}\n`));
  }
}
