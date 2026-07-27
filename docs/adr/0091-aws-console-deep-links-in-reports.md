# ADR-0091: AWS console deep links in JSON/PDF findings, partial coverage by design

- **Status:** Accepted (2026-07-27)

## Context

An external code review (`docs/todo/todo.md`, item 4) flagged that a finding gives its `id` but no way to jump straight to it in the AWS console — a user has to hand-navigate to the right service/region/resource every time. The reviewer's own example (`https://console.aws.amazon.com/ec2/home?region=us-east-1#Volumes:volumeId=vol-xxx`) is one of dozens of different URL shapes across the ~65 kinds spread over `cloud-cost`, `dead-resources` and `resource-security` — EC2/VPC-ish resources, RDS, S3, CloudWatch Logs/Alarms, IAM ARNs, and several fixed account-level pages (password policy, CloudTrail, root MFA) that don't even carry a per-resource ID.

## Decision

`apps/cli/src/aws-console-link.ts` exports `buildConsoleUrl({ kind, id, region }): string | undefined`, grouped by **console area** (`ec2()`, `vpc()`, `rds()`, `s3()`, `cloudwatchLogGroup()`, `cloudwatchAlarm()`, `iamUserByArn()`, `directPath()`, plus ARN-parsing helpers) rather than one template string per kind, since most AWS console areas host many resource kinds under the same URL shape — the shape is written once per console, not copy-pasted ~65 times. A `BUILDERS: Record<string, LinkBuilder | undefined>` map composes these into the full kind list.

**Surface: PDF and JSON only, never the terminal table or Markdown output.** A full console URL is 80-150+ characters — unreadable and destructive to a fixed-width terminal table, and no clearer as raw Markdown text in a PR comment. PDF gets a dedicated `Link` column with a short `Open ↗` label plus an invisible full-cell hyperlink overlay (`doc.link(x, y, w, h, url)`, the same pdfkit technique [ADR-0034](0034-pdfkit-link-linebreak-bug.md) already established) — clicking anywhere in the cell opens the link, no URL text needs to fit. JSON gets the full URL as a new `consoleUrl` field per finding, since a machine consumer (a script, a dashboard) can do whatever it wants with a raw string.

**Built at the CLI layer, not the application layer.** `buildConsoleUrl()` is called from the three JSON formatters (`waste-report.json-formatter.ts`, `dead-resources-report.json-formatter.ts`, `resource-security-report.json-formatter.ts`) and the two PDF formatter families, mapping over `dto.findings` — never inside `toWasteReportDto()`/`toDeadResourceReportDto()`/`toResourceSecurityReportDto()` in the application layer. A console URL is a presentation concern (literally: which UI you render the report in), not a fact about the domain; keeping it in `apps/cli` preserves the hexagonal boundary the rest of the codebase already enforces ([ADR-0075](0075-nx-dep-constraints-layer-enforcement.md)).

**Deliberately incomplete: 10 kinds return `undefined`.** Emitting a guessed-wrong link is worse than omitting one:
- 4 kinds carry an opaque AWS-internal ID with no derivable human-readable name on the public interface: `iam-user-inactive`, `iam-policy-unattached`, `iam-role-unused`, `iam-instance-profile-unattached`.
- 2 kinds carry only an access key ID, but the IAM console needs the username alongside it to resolve a page: `iam-access-key-stale`, `iam-access-key-rotation-overdue`.
- `ec2-keypair-unused` carries the `KeyPairId`, but the console navigates by key **name**, which isn't on the interface.
- `s3-multipart-upload-abandoned` needs a sibling field (the upload's `UploadId`/initiator) not currently exposed on `WastedResource`.
- `environment-ghost` is a synthetic, tag-derived grouping — not a single real AWS resource with one console page.
- `ecr-image-untagged`'s `id` is an image digest; the repository name it lives under isn't on the public interface.

## Alternatives Considered

- **A flat `Record<ResourceKind | DeadResourceKind | ResourceSecurityKind, string>` template map, one entry per kind.** Rejected: most kinds share a console area's URL shape (all EC2/VPC-ish kinds, all RDS kinds, etc.) — a per-kind template would copy-paste the same `https://console.aws.amazon.com/<area>/home?region=...` shape ~65 times, and every future console URL-format change (AWS reshuffles these periodically, most recently the EC2→VPC migration for network resources) would require finding and fixing every copy instead of the one shared builder.
- **Widen the domain interfaces (`WastedResource`/`DeadResource`/`SecurityFinding`) to always carry a `consoleUrl` field, computed by each entity.** Rejected — this is exactly the presentation-concern-in-the-domain-layer violation `apps/cli`-only placement avoids; it would also force every one of the ~65 entity classes to know an AWS console URL shape, duplicating the "grouped by console area" logic per-entity instead of once in the CLI layer.
- **Guess a best-effort link for the 10 uncoverable kinds** (e.g. link to the IAM Users list page instead of the specific user). Rejected by the project owner: a link that doesn't land on the actual resource is worse than no link — it teaches the user not to trust the `Link` column.

## Consequences

`apps/cli/src/aws-console-link.spec.ts` covers every builder category, the ARN-parsing helpers, and all 10 `undefined` cases explicitly (so a future kind added to a domain without updating `BUILDERS` fails a test, not silently ships a broken/missing link). `pdf-shared.ts`'s `drawTable()` gained an optional 7th `links` parameter, used only by the two report families that pass it — every other caller is unaffected. As AWS continues reshuffling console URL fragments, the per-console-area factory functions are the single place to update, not a search across ~65 call sites.
