// SPDX-License-Identifier: Apache-2.0
import {
  ResourceGroupsTaggingAPIClient,
  GetResourcesCommand,
  type ResourceTagMapping,
} from '@aws-sdk/client-resource-groups-tagging-api';
import { EC2Client, DescribeInstancesCommand, type Instance, type Reservation } from '@aws-sdk/client-ec2';
import { RDSClient, DescribeDBInstancesCommand, type DBInstance } from '@aws-sdk/client-rds';
import { LambdaClient, ListFunctionsCommand, type FunctionConfiguration } from '@aws-sdk/client-lambda';
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeTargetGroupsCommand,
  DescribeTargetHealthCommand,
  type LoadBalancer as AwsLoadBalancer,
  type TargetGroup,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { Result } from 'shared-kernel';
import type { AwsRegion, WasteScannerPort, WastedResource } from 'cloud-cost-domain';
import { EnvironmentGhost, EnvironmentGhostPolicy, type WastePolicy } from 'cloud-cost-domain';
import { AwsAdapterError } from '../errors/aws-adapter.error';
import { paginate } from '../utils/paginate';
import { createAwsClientConfig } from '../utils/client-config';
import { sumMetric, metricWindow } from '../utils/cloudwatch-metrics';

// Only these 4 resource types carry a state/idle signal cloudrift already
// knows how to read reliably (stopped, invocation count, registered
// targets). Other tagged/named resource types (S3, DynamoDB, ...) can be
// part of a ghost environment in principle but are out of scope for this
// iteration — see the Option A vs B tradeoff recorded for Phase 6.4
// (ADR-0065): a small, testable allowlist over a generic per-resource-type
// CloudWatch metric map that would be much larger and harder to verify.
const ALLOWED_RESOURCE_TYPE_FILTERS = ['ec2:instance', 'rds:db', 'lambda:function', 'elasticloadbalancing:loadbalancer'];

const DEFAULT_TAG_KEYS = ['Environment', 'env', 'branch'];
const DEFAULT_NAMING_PATTERNS = ['*-pr-*', '*-preview-*', '*-dev-*', '*-feat-*'];
const DEFAULT_INACTIVITY_DAYS = 7;

type ResourceType = 'ec2-instance' | 'rds-instance' | 'lambda-function' | 'load-balancer';

interface ResourceRef {
  type: ResourceType;
  /** EC2: instance ID (DescribeInstances doesn't return an ARN). RDS/Lambda/ELB: the resource's own ARN field, which matches what GetResources returns. */
  key: string;
}

interface ResourceActivity {
  type: ResourceType;
  active: boolean;
  /** Proxy for "since when has this resource looked like this" — the best available field per type, same caveats as the single-resource-type policies (e.g. RdsInstanceWastePolicy) that already accept this limitation. */
  sinceTimestamp: Date;
}

interface ResourceLists {
  ec2Instances: Instance[];
  dbInstances: DBInstance[];
  functions: FunctionConfiguration[];
  loadBalancers: AwsLoadBalancer[];
}

interface ResourceLookups {
  ec2ById: Map<string, Instance>;
  rdsByArn: Map<string, DBInstance>;
  lambdaByArn: Map<string, FunctionConfiguration>;
  lbByArn: Map<string, AwsLoadBalancer>;
}

// AWS only reports the stop time inside StateTransitionReason, as a string
// like "User initiated (2026-06-01 12:34:56 GMT)" — same parsing as
// AwsEc2InstanceScanner.
function parseStoppedSince(stateTransitionReason: string | undefined): Date | undefined {
  const match = stateTransitionReason?.match(/\((.+) GMT\)/);
  if (!match) return undefined;
  const parsed = new Date(`${match[1]} UTC`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function globToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function resourceRefFromArn(arn: string): ResourceRef | undefined {
  switch (arn.split(':')[2]) {
    case 'ec2':
      return { type: 'ec2-instance', key: arn.slice(arn.lastIndexOf('/') + 1) };
    case 'rds':
      return { type: 'rds-instance', key: arn };
    case 'lambda':
      return { type: 'lambda-function', key: arn };
    case 'elasticloadbalancing':
      return { type: 'load-balancer', key: arn };
    default:
      return undefined;
  }
}

interface TagGroup {
  refs: ResourceRef[];
  tags: Record<string, string>;
}

/**
 * Detects groups of resources — correlated by an environment/branch tag, or
 * (fallback, for untagged resources) an ephemeral-environment naming
 * convention — that all look inactive at once: the signature of a Dev/PR
 * environment nobody tore down. See `EnvironmentGhost` for the resource-type
 * scope and cost-model rationale.
 */
export class AwsEnvironmentGhostScanner implements WasteScannerPort {
  readonly kind = 'environment-ghost' as const;

  constructor(
    private readonly accountId = 'unknown',
    private readonly policy: WastePolicy<EnvironmentGhost> = new EnvironmentGhostPolicy(),
    private readonly tagKeys: string[] = DEFAULT_TAG_KEYS,
    private readonly namingPatterns: string[] = DEFAULT_NAMING_PATTERNS,
    private readonly inactivityDays = DEFAULT_INACTIVITY_DAYS,
  ) {}

  async scan(region: AwsRegion): Promise<Result<WastedResource[]>> {
    const taggingClient = new ResourceGroupsTaggingAPIClient({ ...createAwsClientConfig(), region: region.code });
    const ec2Client = new EC2Client({ ...createAwsClientConfig(), region: region.code });
    const rdsClient = new RDSClient({ ...createAwsClientConfig(), region: region.code });
    const lambdaClient = new LambdaClient({ ...createAwsClientConfig(), region: region.code });
    const elbClient = new ElasticLoadBalancingV2Client({ ...createAwsClientConfig(), region: region.code });
    const cwClient = new CloudWatchClient({ ...createAwsClientConfig(), region: region.code });

    try {
      const [ec2Instances, dbInstances, functions, loadBalancers] = await Promise.all([
        this.listEc2Instances(ec2Client),
        this.listRdsInstances(rdsClient),
        this.listLambdaFunctions(lambdaClient),
        this.listLoadBalancers(elbClient),
      ]);
      const lists: ResourceLists = { ec2Instances, dbInstances, functions, loadBalancers };
      const lookups: ResourceLookups = {
        ec2ById: new Map(ec2Instances.filter((i): i is Instance & { InstanceId: string } => !!i.InstanceId).map((i) => [i.InstanceId, i])),
        rdsByArn: new Map(dbInstances.filter((d): d is DBInstance & { DBInstanceArn: string } => !!d.DBInstanceArn).map((d) => [d.DBInstanceArn, d])),
        lambdaByArn: new Map(functions.filter((f): f is FunctionConfiguration & { FunctionArn: string } => !!f.FunctionArn).map((f) => [f.FunctionArn, f])),
        lbByArn: new Map(loadBalancers.filter((l): l is AwsLoadBalancer & { LoadBalancerArn: string } => !!l.LoadBalancerArn).map((l) => [l.LoadBalancerArn, l])),
      };

      const tagGroups = await this.groupByTag(taggingClient);
      const claimed = new Set<string>();
      for (const group of tagGroups.values()) {
        for (const ref of group.refs) claimed.add(`${ref.type}:${ref.key}`);
      }
      const namingCandidates = this.findNamingPatternCandidates(lists, claimed);

      const now = new Date();
      const entities: EnvironmentGhost[] = [];
      for (const [envName, group] of tagGroups) {
        const entity = await this.buildGroup(envName, 'tag', group.refs, group.tags, region, now, lookups, elbClient, cwClient);
        if (entity) entities.push(entity);
      }
      for (const candidate of namingCandidates) {
        const entity = await this.buildGroup(candidate.name, 'naming-pattern', [candidate.ref], {}, region, now, lookups, elbClient, cwClient);
        if (entity) entities.push(entity);
      }

      return Result.ok(entities.filter((e) => this.policy.evaluate(e, now).isWaste));
    } catch (err) {
      return Result.fail(new AwsAdapterError('ResourceGroupsTaggingAPI', err as Error));
    } finally {
      taggingClient.destroy();
      ec2Client.destroy();
      rdsClient.destroy();
      lambdaClient.destroy();
      elbClient.destroy();
      cwClient.destroy();
    }
  }

  private async listEc2Instances(client: EC2Client): Promise<Instance[]> {
    const reservations = await paginate<Reservation>(async (cursor) => {
      const r = await client.send(
        new DescribeInstancesCommand({
          Filters: [{ Name: 'instance-state-name', Values: ['pending', 'running', 'shutting-down', 'stopping', 'stopped'] }],
          NextToken: cursor,
        }),
      );
      return { items: r.Reservations ?? [], cursor: r.NextToken };
    });
    return reservations.flatMap((r) => r.Instances ?? []);
  }

  private listRdsInstances(client: RDSClient): Promise<DBInstance[]> {
    return paginate<DBInstance>(async (cursor) => {
      const r = await client.send(new DescribeDBInstancesCommand({ Marker: cursor }));
      return { items: r.DBInstances ?? [], cursor: r.Marker };
    });
  }

  private listLambdaFunctions(client: LambdaClient): Promise<FunctionConfiguration[]> {
    return paginate<FunctionConfiguration>(async (cursor) => {
      const r = await client.send(new ListFunctionsCommand({ Marker: cursor }));
      return { items: r.Functions ?? [], cursor: r.NextMarker };
    });
  }

  private listLoadBalancers(client: ElasticLoadBalancingV2Client): Promise<AwsLoadBalancer[]> {
    return paginate<AwsLoadBalancer>(async (cursor) => {
      const r = await client.send(new DescribeLoadBalancersCommand({ Marker: cursor }));
      return { items: r.LoadBalancers ?? [], cursor: r.NextMarker };
    });
  }

  /**
   * One `GetResources` call per configured tag key (multiple `TagFilters` in
   * a single call are ANDed together by AWS, but we want an OR across
   * `Environment`/`env`/`branch`) — a resource already claimed by an
   * earlier-priority key is skipped for the later ones, so it never ends up
   * double-counted across two groups.
   */
  private async groupByTag(client: ResourceGroupsTaggingAPIClient): Promise<Map<string, TagGroup>> {
    const groups = new Map<string, TagGroup>();
    const claimed = new Set<string>();

    for (const tagKey of this.tagKeys) {
      const mappings = await paginate<ResourceTagMapping>(async (cursor) => {
        const r = await client.send(
          new GetResourcesCommand({
            TagFilters: [{ Key: tagKey }],
            ResourceTypeFilters: ALLOWED_RESOURCE_TYPE_FILTERS,
            PaginationToken: cursor,
          }),
        );
        return { items: r.ResourceTagMappingList ?? [], cursor: r.PaginationToken || undefined };
      });

      for (const mapping of mappings) {
        if (!mapping.ResourceARN) continue;
        const ref = resourceRefFromArn(mapping.ResourceARN);
        if (!ref) continue;
        const claimKey = `${ref.type}:${ref.key}`;
        if (claimed.has(claimKey)) continue;
        const tagRecord = Object.fromEntries((mapping.Tags ?? []).map((t) => [t.Key ?? '', t.Value ?? '']));
        const envName = tagRecord[tagKey];
        if (!envName) continue;
        claimed.add(claimKey);
        const group = groups.get(envName) ?? { refs: [], tags: {} };
        group.refs.push(ref);
        Object.assign(group.tags, tagRecord);
        groups.set(envName, group);
      }
    }
    return groups;
  }

  /**
   * Fallback for resources with no matching Environment/env/branch tag:
   * matches the resource's own name against the configured naming patterns.
   * Each match becomes its own single-resource group — unlike tag grouping,
   * there's no reliable shared identifier to safely correlate multiple
   * naming-matched resources into one environment (name collisions across
   * resource types are possible, and guessing a shared "slug" out of an
   * arbitrary glob match risks grouping unrelated resources together).
   */
  private findNamingPatternCandidates(
    lists: ResourceLists,
    claimed: ReadonlySet<string>,
  ): Array<{ name: string; ref: ResourceRef }> {
    const patterns = this.namingPatterns.map(globToRegExp);
    const matches = (name: string) => patterns.some((p) => p.test(name));
    const out: Array<{ name: string; ref: ResourceRef }> = [];

    for (const inst of lists.ec2Instances) {
      if (!inst.InstanceId || claimed.has(`ec2-instance:${inst.InstanceId}`)) continue;
      const name = inst.Tags?.find((t) => t.Key === 'Name')?.Value ?? inst.InstanceId;
      if (matches(name)) out.push({ name, ref: { type: 'ec2-instance', key: inst.InstanceId } });
    }
    for (const db of lists.dbInstances) {
      if (!db.DBInstanceArn || !db.DBInstanceIdentifier || claimed.has(`rds-instance:${db.DBInstanceArn}`)) continue;
      if (matches(db.DBInstanceIdentifier)) out.push({ name: db.DBInstanceIdentifier, ref: { type: 'rds-instance', key: db.DBInstanceArn } });
    }
    for (const fn of lists.functions) {
      if (!fn.FunctionArn || !fn.FunctionName || claimed.has(`lambda-function:${fn.FunctionArn}`)) continue;
      if (matches(fn.FunctionName)) out.push({ name: fn.FunctionName, ref: { type: 'lambda-function', key: fn.FunctionArn } });
    }
    for (const lb of lists.loadBalancers) {
      if (!lb.LoadBalancerArn || !lb.LoadBalancerName || claimed.has(`load-balancer:${lb.LoadBalancerArn}`)) continue;
      if (matches(lb.LoadBalancerName)) out.push({ name: lb.LoadBalancerName, ref: { type: 'load-balancer', key: lb.LoadBalancerArn } });
    }
    return out;
  }

  private async buildGroup(
    environmentName: string,
    detectionMethod: 'tag' | 'naming-pattern',
    refs: ResourceRef[],
    tags: Record<string, string>,
    region: AwsRegion,
    now: Date,
    lookups: ResourceLookups,
    elbClient: ElasticLoadBalancingV2Client,
    cwClient: CloudWatchClient,
  ): Promise<EnvironmentGhost | undefined> {
    const activities = (
      await Promise.all(refs.map((ref) => this.resolveActivity(ref, lookups, elbClient, cwClient, now)))
    ).filter((a): a is ResourceActivity => a !== undefined);
    if (activities.length === 0) return undefined;

    const inactiveResourceCount = activities.filter((a) => !a.active).length;
    const lastActivityTimestamp = activities.reduce(
      (max, a) => (a.sinceTimestamp > max ? a.sinceTimestamp : max),
      new Date(0),
    );

    return new EnvironmentGhost({
      environmentName,
      detectionMethod,
      resourceCount: activities.length,
      resourceTypes: [...new Set(activities.map((a) => a.type))],
      inactiveResourceCount,
      lastActivityTimestamp,
      region,
      accountId: this.accountId,
      tags,
      detectedAt: now,
    });
  }

  private async resolveActivity(
    ref: ResourceRef,
    lookups: ResourceLookups,
    elbClient: ElasticLoadBalancingV2Client,
    cwClient: CloudWatchClient,
    now: Date,
  ): Promise<ResourceActivity | undefined> {
    switch (ref.type) {
      case 'ec2-instance': {
        const inst = lookups.ec2ById.get(ref.key);
        if (!inst) return undefined;
        const stopped = inst.State?.Name === 'stopped';
        return {
          type: 'ec2-instance',
          active: !stopped,
          sinceTimestamp: stopped ? parseStoppedSince(inst.StateTransitionReason) ?? inst.LaunchTime ?? new Date(0) : now,
        };
      }
      case 'rds-instance': {
        const db = lookups.rdsByArn.get(ref.key);
        if (!db) return undefined;
        // AWS auto-restarts an RDS instance left stopped for 7 days: if we
        // observe `stopped`, it is by definition recent — same caveat
        // RdsInstanceWastePolicy already accepts for the single-instance scanner.
        const stopped = db.DBInstanceStatus === 'stopped';
        return { type: 'rds-instance', active: !stopped, sinceTimestamp: stopped ? db.InstanceCreateTime ?? new Date(0) : now };
      }
      case 'lambda-function': {
        const fn = lookups.lambdaByArn.get(ref.key);
        if (!fn?.FunctionName) return undefined;
        const invocations = await sumMetric(
          cwClient,
          'AWS/Lambda',
          'Invocations',
          [{ Name: 'FunctionName', Value: fn.FunctionName }],
          metricWindow(this.inactivityDays * 24),
        );
        const active = invocations > 0;
        return { type: 'lambda-function', active, sinceTimestamp: active ? now : fn.LastModified ? new Date(fn.LastModified) : new Date(0) };
      }
      case 'load-balancer': {
        const lb = lookups.lbByArn.get(ref.key);
        if (!lb) return undefined;
        const registeredTargets = await this.countRegisteredTargets(elbClient, lb);
        const active = registeredTargets > 0;
        return { type: 'load-balancer', active, sinceTimestamp: active ? now : lb.CreatedTime ?? new Date(0) };
      }
    }
  }

  // Same approach as AwsLoadBalancerScanner: more precise than "target groups
  // exist" — an LB can have target groups configured but empty.
  private async countRegisteredTargets(client: ElasticLoadBalancingV2Client, lb: AwsLoadBalancer): Promise<number> {
    const targetGroups = await paginate<TargetGroup>(async (cursor) => {
      const r = await client.send(new DescribeTargetGroupsCommand({ LoadBalancerArn: lb.LoadBalancerArn, Marker: cursor }));
      return { items: r.TargetGroups ?? [], cursor: r.NextMarker };
    });

    let total = 0;
    for (const tg of targetGroups) {
      const healthResponse = await client.send(new DescribeTargetHealthCommand({ TargetGroupArn: tg.TargetGroupArn }));
      total += (healthResponse.TargetHealthDescriptions ?? []).length;
    }
    return total;
  }
}
