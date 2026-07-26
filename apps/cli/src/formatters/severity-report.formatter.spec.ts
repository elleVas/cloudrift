// SPDX-License-Identifier: Apache-2.0
import { mkdtemp, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  SeverityReportFormatter,
  type Severity,
  type SeverityReportSummary,
  type SeverityReportPdfMeta,
} from './severity-report.formatter';

// Fixture subclass with fake kinds/presenters — exercises the shared
// template method (toTable/toPdf) without depending on any real domain's
// entities, so this spec is the single place that covers every branch once,
// instead of duplicating branch coverage across dead-resources and
// resource-security (the exact duplication this class was extracted to
// remove — see severity-report.formatter.ts's class doc comment).
type FixtureKind = 'alpha' | 'beta';

interface FixtureFinding {
  kind: FixtureKind;
  severity: Severity;
  id: string;
}

class FixtureFormatter extends SeverityReportFormatter<FixtureKind, FixtureFinding> {
  protected readonly kinds: readonly FixtureKind[] = ['alpha', 'beta'];
  protected readonly reportTitle = 'Fixture Report';
  protected readonly noFindingsMessage = 'No fixture findings found.';
  protected readonly disclaimer = 'Fixture disclaimer text.';

  protected kindLabel(kind: FixtureKind): string {
    return kind === 'alpha' ? 'Alpha Findings' : 'Beta Findings';
  }

  protected groupByKind(findings: FixtureFinding[]): Record<FixtureKind, FixtureFinding[]> {
    return {
      alpha: findings.filter((f) => f.kind === 'alpha'),
      beta: findings.filter((f) => f.kind === 'beta'),
    };
  }

  protected presenterFor(kind: FixtureKind): { title: string; head: string[] } {
    return kind === 'alpha' ? { title: 'Alpha Section', head: ['ID'] } : { title: 'Beta Section', head: ['ID'] };
  }

  protected rowFor(finding: FixtureFinding): string[] {
    return [finding.id];
  }

  protected recommendFor(finding: FixtureFinding): string {
    return `Fix ${finding.id}`;
  }
}

const formatter = new FixtureFormatter();
const meta: SeverityReportPdfMeta = {
  accountId: '123456789012',
  regions: ['us-east-1'],
  generatedAt: new Date('2026-07-26T12:00:00Z'),
};

function summary(
  findings: FixtureFinding[],
  countBySeverity: Record<Severity, number>,
  scanErrors: SeverityReportSummary<FixtureKind, FixtureFinding>['scanErrors'] = [],
): SeverityReportSummary<FixtureKind, FixtureFinding> {
  return { findings, countBySeverity, scanErrors };
}

describe('SeverityReportFormatter.toTable', () => {
  it('shows the no-findings message when there are no findings and no scan errors', () => {
    const table = formatter.toTable(summary([], { info: 0, warning: 0, critical: 0 }));
    expect(table).toContain('No fixture findings found.');
    expect(table).not.toContain('Alpha Section');
    expect(table).not.toContain('Beta Section');
  });

  it('renders one section per kind that has findings, skipping kinds with none', () => {
    const table = formatter.toTable(
      summary(
        [
          { kind: 'alpha', severity: 'critical', id: 'a1' },
          { kind: 'alpha', severity: 'info', id: 'a2' },
        ],
        { info: 1, warning: 0, critical: 1 },
      ),
    );
    expect(table).toContain('Alpha Section');
    expect(table).toContain('a1');
    expect(table).toContain('a2');
    expect(table).not.toContain('Beta Section');
    expect(table).not.toContain('No fixture findings found.');
  });

  it('renders every kind with findings, in kind order', () => {
    const table = formatter.toTable(
      summary(
        [
          { kind: 'beta', severity: 'warning', id: 'b1' },
          { kind: 'alpha', severity: 'info', id: 'a1' },
        ],
        { info: 1, warning: 1, critical: 0 },
      ),
    );
    expect(table).toContain('Alpha Section');
    expect(table).toContain('Beta Section');
    expect(table.indexOf('Alpha Section')).toBeLessThan(table.indexOf('Beta Section'));
  });

  it('renders scan warnings with kind/region/error message, and marks the total incomplete', () => {
    const table = formatter.toTable(
      summary([{ kind: 'alpha', severity: 'info', id: 'a1' }], { info: 1, warning: 0, critical: 0 }, [
        { kind: 'beta', region: 'eu-west-1', error: new Error('AccessDenied') },
      ]),
    );
    expect(table).toContain('Scan warnings — partial results');
    expect(table).toContain('beta in eu-west-1: AccessDenied');
    expect(table).toContain('(incomplete — see warnings above)');
  });

  it('does not show the no-findings message when scan errors exist but findings are empty', () => {
    const table = formatter.toTable(
      summary([], { info: 0, warning: 0, critical: 0 }, [
        { kind: 'alpha', region: 'us-east-1', error: new Error('Timeout') },
      ]),
    );
    expect(table).not.toContain('No fixture findings found.');
    expect(table).toContain('Scan warnings — partial results');
  });

  it('totals findings by severity in the summary line', () => {
    const table = formatter.toTable(
      summary(
        [
          { kind: 'alpha', severity: 'critical', id: 'a1' },
          { kind: 'alpha', severity: 'critical', id: 'a2' },
          { kind: 'beta', severity: 'warning', id: 'b1' },
          { kind: 'beta', severity: 'info', id: 'b2' },
        ],
        { info: 1, warning: 1, critical: 2 },
      ),
    );
    expect(table).toContain('Total: 4 finding(s)');
    expect(table).toContain('2 critical, 1 warning, 1 info');
  });
});

describe('SeverityReportFormatter.toPdf', () => {
  async function renderToFile(
    s: SeverityReportSummary<FixtureKind, FixtureFinding>,
    filename: string,
  ): Promise<Buffer> {
    const dir = await mkdtemp(join(tmpdir(), 'cloudrift-severity-pdf-'));
    const file = join(dir, filename);
    try {
      await formatter.toPdf(s, meta, file);
      return await readFile(file);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it('writes a valid PDF for a summary spanning multiple kinds', async () => {
    const written = await renderToFile(
      summary(
        [
          { kind: 'alpha', severity: 'critical', id: 'a1' },
          { kind: 'beta', severity: 'info', id: 'b1' },
        ],
        { info: 1, warning: 0, critical: 1 },
      ),
      'multi.pdf',
    );
    expect(written.subarray(0, 5).toString('latin1')).toBe('%PDF-');
    expect(written.length).toBeGreaterThan(1000);
  });

  it('writes a valid PDF when there are no findings', async () => {
    const written = await renderToFile(summary([], { info: 0, warning: 0, critical: 0 }), 'empty.pdf');
    expect(written.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('writes a valid PDF when there are scan warnings', async () => {
    const written = await renderToFile(
      summary([{ kind: 'alpha', severity: 'info', id: 'a1' }], { info: 1, warning: 0, critical: 0 }, [
        { kind: 'beta', region: 'global', error: new Error('AccessDenied') },
      ]),
      'warnings.pdf',
    );
    expect(written.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});
