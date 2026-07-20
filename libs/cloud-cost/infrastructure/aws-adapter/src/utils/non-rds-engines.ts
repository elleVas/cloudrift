// SPDX-License-Identifier: Apache-2.0

/**
 * `rds:DescribeDBInstances` also returns DocumentDB and Neptune instances
 * (both are RDS-engine-compatible under the hood), distinguishable only by
 * `Engine`. They already have dedicated scanners (`aws-documentdb-idle`,
 * `aws-neptune-idle`) with their own server-side engine filters, so RDS
 * scanners must exclude them here to avoid duplicate/mislabeled findings.
 */
export const NON_RDS_ENGINES: ReadonlySet<string> = new Set(['docdb', 'neptune']);
