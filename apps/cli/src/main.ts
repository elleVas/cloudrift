#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
import { program } from 'commander';
import { analyzeWasteCommand } from './commands/analyze-waste.command';

program
  .name('cloudrift')
  .description('Detect and report wasted AWS cloud resources')
  .version('0.3.0');

program
  .command('analyze')
  .description('Scan AWS account for wasted resources and estimate monthly cost')
  .option(
    '-r, --regions <regions...>',
    'AWS regions to scan',
    ['us-east-1'],
  )
  .option(
    '--account-id <id>',
    'AWS account ID override (auto-detected via STS when omitted)',
  )
  .option(
    '--config <path>',
    'path to a cloudrift config file (defaults to cloudrift.config.json / .cloudriftrc in the cwd)',
  )
  .option(
    '--live-pricing',
    'fetch current list prices from the AWS Pricing API (falls back to the static table; config prices still win)',
  )
  .option(
    '--scanners <kinds...>',
    'only run these services (space-separated resource kinds, e.g. ebs-volume elastic-ip); skips the interactive picker',
  )
  .option(
    '--all-services',
    'run every scanner without the interactive picker (default in CI / when stdout is not a terminal)',
  )
  .option(
    '--min-age-days <days>',
    'grace period: resources younger than this many days are not reported (default 7, overrides config)',
  )
  .option(
    '--ignore-tag <tag>',
    'resources carrying this tag are excluded from the report (default cloudrift:ignore, overrides config)',
  )
  .option(
    '--format <format>',
    'stdout output format: table (default), json, or markdown (for CI / PR comments)',
    'table',
  )
  // [filename] is an optional value: commander only attaches it to --pdf/--json
  // when it immediately follows the flag. `--pdf --silent ./report.pdf` fails
  // ("too many arguments") because --silent gets in the way first, leaving
  // the path orphaned. Use `--pdf=./report.pdf` to make flag order irrelevant.
  .option(
    '--pdf [filename]',
    'Also write a PDF report to disk (optional filename, defaults to reports/AWS_report_YYYY_MM_DD.pdf)',
  )
  .option(
    '--json [filename]',
    'Also write a JSON report to disk (optional filename, defaults to reports/AWS_report_YYYY_MM_DD.json)',
  )
  .option(
    '--silent',
    'suppress all stdout output (banner, report, confirmations) — use with --pdf/--json for file-only output. Errors and the cost-gate alert still surface.',
  )
  .action((options) => analyzeWasteCommand(options));

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
