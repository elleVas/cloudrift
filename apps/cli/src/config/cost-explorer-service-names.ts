// SPDX-License-Identifier: Apache-2.0

/**
 * Best-effort shorthand → Cost Explorer service display name mapping for
 * `trend --services`. Cost Explorer groups by AWS's own billing service
 * names, which don't always match the product name (e.g. EBS/Elastic
 * IP/NAT Gateway costs are billed under "EC2 - Other", not a service of
 * their own). Only the highest-confidence, most commonly requested
 * shorthands are covered — anything not in this table is passed through
 * unchanged, so the exact Cost Explorer name always works even for a
 * service with no shorthand yet.
 */
const SERVICE_SHORTHANDS: Record<string, string> = {
  ec2: 'Amazon Elastic Compute Cloud - Compute',
  ebs: 'EC2 - Other',
  s3: 'Amazon Simple Storage Service',
  rds: 'Amazon Relational Database Service',
  lambda: 'AWS Lambda',
  dynamodb: 'Amazon DynamoDB',
  elasticache: 'Amazon ElastiCache',
  redshift: 'Amazon Redshift',
  elb: 'Elastic Load Balancing',
  sqs: 'Amazon Simple Queue Service',
  sns: 'Amazon Simple Notification Service',
  cloudfront: 'Amazon CloudFront',
};

export function resolveServiceNames(tokens: readonly string[]): string[] {
  return tokens.map((token) => SERVICE_SHORTHANDS[token.toLowerCase()] ?? token);
}
