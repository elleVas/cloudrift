#!/usr/bin/env node
import { program } from 'commander';
import { analyzeWasteCommand } from './commands/analyze-waste.command';

program
  .name('cloudrift')
  .description('Detect and report wasted AWS cloud resources')
  .version('0.1.0');

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
    'AWS account ID (12-digit number visible in the AWS console, e.g. 123456789012)',
    'unknown',
  )
  .option(
    '--pdf [filename]',
    'Export a PDF report (optional filename, defaults to cloudrift-report-YYYY-MM-DD.pdf)',
  )
  .action(analyzeWasteCommand);

program.parseAsync(process.argv).catch((err: Error) => {
  console.error(err.message);
  process.exit(1);
});
