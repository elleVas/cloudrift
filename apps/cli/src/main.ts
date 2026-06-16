#!/usr/bin/env node
import { program } from 'commander';
import { analyzeWasteCommand } from './commands/analyze-waste.command';

program
  .name('cloudrift')
  .description('Detect and report wasted AWS cloud resources')
  .version('0.2.0');

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
    '--min-age-days <days>',
    'grace period: resources younger than this many days are not reported',
    '7',
  )
  .option(
    '--ignore-tag <tag>',
    'resources carrying this tag are excluded from the report',
    'cloudrift:ignore',
  )
  .option(
    '--pdf [filename]',
    'Export a PDF report (optional filename, defaults to cloudrift-report-YYYY-MM-DD.pdf)',
  )
  .option(
    '--json [filename]',
    'Output the report as JSON (to stdout when no filename is given)',
  )
  .action(analyzeWasteCommand);

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
