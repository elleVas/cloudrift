// SPDX-License-Identifier: Apache-2.0

/** Minimal shape of an AWS IAM/resource policy statement — only the fields the v2 resource-security checks need. */
export interface PolicyStatement {
  Effect?: string;
  Principal?: unknown;
  Action?: string | string[];
  Resource?: string | string[];
  Condition?: unknown;
}

interface PolicyDocument {
  Statement?: PolicyStatement | PolicyStatement[];
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Parses a policy document JSON string (IAM inline/managed policy documents
 * come URL-encoded — decode with `decodeURIComponent` before calling this;
 * resource policies from Lambda/SNS/SQS/ECR/Secrets Manager are already
 * plain JSON) into its list of statements. Returns `[]` on a missing or
 * unparseable document rather than throwing — a malformed policy shouldn't
 * fail the whole scan, just skip that one resource.
 */
export function parsePolicyStatements(policyJson: string | undefined): PolicyStatement[] {
  if (!policyJson) return [];
  try {
    const doc = JSON.parse(policyJson) as PolicyDocument;
    return toArray(doc.Statement);
  } catch {
    return [];
  }
}

/** `Action`/`Resource`/`Principal.AWS` on a statement can be a single string or an array — normalizes to an array. */
export function statementValues(value: string | string[] | undefined): string[] {
  return toArray(value);
}

/**
 * True when a statement's `Principal` grants access to anyone: the bare
 * string `"*"`, or `{ "AWS": "*" }` / `{ "AWS": ["*", ...] }`.
 */
export function isWildcardPrincipal(principal: unknown): boolean {
  if (principal === '*') return true;
  if (typeof principal !== 'object' || principal === null) return false;
  const aws = (principal as Record<string, unknown>).AWS;
  if (typeof aws === 'string') return aws === '*';
  if (Array.isArray(aws)) return aws.includes('*');
  return false;
}
