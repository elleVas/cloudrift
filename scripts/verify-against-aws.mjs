// Verifica manuale contro un account AWS sandbox reale: per ogni scanner,
// esegue le chiamate AWS vere e stampa cosa trova, accanto al descrittore
// statico della query (Namespace/Dimensions/Period/Statistics o filtri
// Describe*) — lo stesso che gli spec dei singoli scanner asseriscono già
// contro l'SDK mockato in CI. Questo script non sostituisce quegli spec,
// conferma solo che, sui dati reali, filtri e calcoli producono i risultati
// attesi. Non è richiamato da `pnpm test` né dalla CI: va lanciato a mano
// contro un account AWS sandbox, mai contro un account di produzione.
//
// Uso: CLOUDRIFT_VERIFY_AWS_SANDBOX=1 node scripts/verify-against-aws.mjs [--region us-east-1]

import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDir, '..');

const requiredDistDirs = [
  resolve(workspaceRoot, 'libs/cloud-cost/domain/dist'),
  resolve(workspaceRoot, 'libs/cloud-cost/infrastructure/aws-adapter/dist'),
];
const missingDist = requiredDistDirs.filter((dir) => !existsSync(dir));
if (missingDist.length > 0) {
  console.error('Build the workspace before running this script:\n');
  console.error('  pnpm nx run-many -t build\n');
  console.error('Missing dist/ for:');
  for (const dir of missingDist) console.error(`  ${dir}`);
  process.exit(1);
}

// Gate di sicurezza: niente run accidentali contro un profilo AWS di
// default/produzione. L'utente deve confermare esplicitamente che la regione
// e le credenziali correnti puntano a un account sandbox.
if (process.env.CLOUDRIFT_VERIFY_AWS_SANDBOX !== '1') {
  console.error(
    'Refusing to run: this script calls real AWS APIs against the AWS account/region\n' +
      'your current credentials resolve to. Set CLOUDRIFT_VERIFY_AWS_SANDBOX=1 to confirm\n' +
      'that targets a sandbox account, not production.\n',
  );
  process.exit(1);
}

const { values } = parseArgs({
  options: { region: { type: 'string', default: 'us-east-1' } },
});

const {
  AwsEbsVolumeScanner,
  AwsElasticIpScanner,
  AwsRdsInstanceScanner,
  AwsLoadBalancerScanner,
  AwsEc2InstanceScanner,
  AwsEbsSnapshotScanner,
  AwsNatGatewayScanner,
  AwsGp2UpgradeScanner,
  AwsEbsIdleScanner,
  AwsEc2UnderutilizedScanner,
  AwsRdsUnderutilizedScanner,
  StaticPriceTableAdapter,
  AwsPricingApiAdapter,
  resolveAwsAccountId,
} = await import('cloud-cost-infrastructure-aws-adapter');
const { AwsRegion } = await import('cloud-cost-domain');

const accountId = await resolveAwsAccountId();
if (!accountId) {
  console.error(
    'Could not resolve an AWS account id via STS GetCallerIdentity — check your credentials\n' +
      '(AWS_PROFILE / AWS_ACCESS_KEY_ID / etc.) before running this script.',
  );
  process.exit(1);
}

const region = AwsRegion.create(values.region);

console.log(`Account: ${accountId}`);
console.log(`Region:  ${region.code}`);
console.log(
  'Calling real, read-only AWS APIs (Describe*/GetMetricStatistics) — nothing is modified.\n',
);

// EC2/RDS underutilized hanno bisogno di un prezzo per instance type/classe:
// StaticPriceTableAdapter non lo fornisce (cardinalità troppo alta per un
// listino statico), quindi qui — come nella CLI con --live-pricing — usano
// AwsPricingApiAdapter invece del listino statico usato dagli altri 9.
const pricing = new StaticPriceTableAdapter();
const livePricing = new AwsPricingApiAdapter();

const checks = [
  {
    kind: 'ebs-volume',
    scanner: new AwsEbsVolumeScanner(pricing, accountId),
    query: "DescribeVolumes Filters=[status=available] — shape guaranteed by aws-ebs-volume.scanner.spec.ts",
  },
  {
    kind: 'elastic-ip',
    scanner: new AwsElasticIpScanner(pricing, accountId),
    query: "DescribeAddresses Filters=[domain=vpc]; waste = no AssociationId — shape guaranteed by aws-elastic-ip.scanner.spec.ts",
  },
  {
    kind: 'rds-instance',
    scanner: new AwsRdsInstanceScanner(pricing, accountId),
    query: "DescribeDBInstances Filters=[db-instance-status=stopped] — shape guaranteed by aws-rds-instance.scanner.spec.ts",
  },
  {
    kind: 'load-balancer',
    scanner: new AwsLoadBalancerScanner(pricing, accountId),
    query: "DescribeLoadBalancers + DescribeTargetGroups + DescribeTargetHealth; waste = zero registered targets — shape guaranteed by aws-load-balancer.scanner.spec.ts",
  },
  {
    kind: 'ec2-instance',
    scanner: new AwsEc2InstanceScanner(pricing, accountId),
    query: "DescribeInstances Filters=[instance-state-name=stopped] — shape guaranteed by aws-ec2-instance.scanner.spec.ts",
  },
  {
    kind: 'ebs-snapshot',
    scanner: new AwsEbsSnapshotScanner(pricing, accountId),
    query: "DescribeSnapshots OwnerIds=[self] + DescribeVolumes + DescribeImages; waste = source volume deleted, not bound to an AMI — shape guaranteed by aws-ebs-snapshot.scanner.spec.ts",
  },
  {
    kind: 'nat-gateway',
    scanner: new AwsNatGatewayScanner(pricing, accountId),
    query: "DescribeNatGateways + GetMetricStatistics Namespace=AWS/NATGateway MetricName=BytesOutToDestination Period=48h Statistics=[Sum] — shape guaranteed by aws-nat-gateway.scanner.spec.ts",
  },
  {
    kind: 'ebs-gp2-upgrade',
    scanner: new AwsGp2UpgradeScanner(pricing, accountId),
    query: "DescribeVolumes Filters=[volume-type=gp2, status=in-use] — shape guaranteed by aws-gp2-upgrade.scanner.spec.ts",
  },
  {
    kind: 'ebs-idle',
    scanner: new AwsEbsIdleScanner(pricing, accountId),
    query: "DescribeVolumes Filters=[status=in-use] + GetMetricStatistics Namespace=AWS/EBS MetricName=VolumeReadOps/VolumeWriteOps Period=48h Statistics=[Sum] — shape guaranteed by aws-ebs-idle.scanner.spec.ts",
  },
  {
    kind: 'ec2-underutilized',
    scanner: new AwsEc2UnderutilizedScanner(livePricing, accountId),
    query: "DescribeInstances Filters=[instance-state-name=running] + GetMetricStatistics Namespace=AWS/EC2 MetricName=CPUUtilization Period=168h Statistics=[Average,Maximum] — shape guaranteed by aws-ec2-underutilized.scanner.spec.ts",
  },
  {
    kind: 'rds-underutilized',
    scanner: new AwsRdsUnderutilizedScanner(livePricing, accountId),
    query: "DescribeDBInstances Filters=[db-instance-status=available] + GetMetricStatistics Namespace=AWS/RDS MetricName=CPUUtilization Period=168h Statistics=[Average,Maximum] — shape guaranteed by aws-rds-underutilized.scanner.spec.ts",
  },
];

for (const { kind, scanner, query } of checks) {
  console.log(`\n=== ${kind} ===`);
  console.log(`query: ${query}`);

  const result = await scanner.scan(region);
  if (!result.ok) {
    console.log(`error: ${result.error.message}`);
    continue;
  }

  const findings = result.value;
  const totalCostUsd = findings.reduce((sum, f) => sum + f.costEstimate.monthlyCostUsd, 0);
  console.log(`findings: ${findings.length}, estimated $${totalCostUsd.toFixed(2)}/mo`);

  for (const finding of findings.slice(0, 5)) {
    console.log(
      `  - ${finding.id}: ${finding.wasteReason} ($${finding.costEstimate.monthlyCostUsd.toFixed(2)}/mo)`,
    );
  }
  if (findings.length > 5) {
    console.log(`  ... and ${findings.length - 5} more`);
  }
}
