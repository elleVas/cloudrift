import { OverprovisionedDynamoDbTable } from './overprovisioned-dynamodb-table.entity';
import type { OverprovisionedDynamoDbTableProps } from './overprovisioned-dynamodb-table.entity';
import { AwsRegion } from '../value-objects/aws-region.value-object';

const region = AwsRegion.create('eu-west-1');
const WINDOW_DAYS = 7;
const WINDOW_SECONDS = WINDOW_DAYS * 24 * 60 * 60;

function makeTable(overrides: Partial<OverprovisionedDynamoDbTableProps> = {}): OverprovisionedDynamoDbTable {
  return new OverprovisionedDynamoDbTable({
    tableName: 'my-table',
    region,
    accountId: '123456789012',
    readCapacityUnits: 100,
    writeCapacityUnits: 100,
    consumedReadCapacityUnits: 0,
    consumedWriteCapacityUnits: 0,
    windowDays: WINDOW_DAYS,
    creationDateTime: new Date('2024-03-01'),
    detectedAt: new Date('2026-06-09'),
    tags: { Env: 'dev' },
    monthlyCostUsd: 12.5,
    ...overrides,
  });
}

describe('OverprovisionedDynamoDbTable', () => {
  it('exposes correct id and fields', () => {
    const table = makeTable();
    expect(table.id).toBe('my-table');
    expect(table.readCapacityUnits).toBe(100);
    expect(table.tags).toEqual({ Env: 'dev' });
  });

  it('computes avgReadUtilizationPercent from consumed/provisioned/window', () => {
    const consumed = 50 * WINDOW_SECONDS; // avg 50 RCU/s consumed vs 100 RCU provisioned = 50%
    expect(makeTable({ consumedReadCapacityUnits: consumed }).avgReadUtilizationPercent).toBeCloseTo(50, 1);
  });

  it('computes avgWriteUtilizationPercent from consumed/provisioned/window', () => {
    const consumed = 10 * WINDOW_SECONDS; // avg 10 WCU/s consumed vs 100 WCU provisioned = 10%
    expect(makeTable({ consumedWriteCapacityUnits: consumed }).avgWriteUtilizationPercent).toBeCloseTo(10, 1);
  });

  it('utilization is zero when provisioned capacity is zero', () => {
    expect(makeTable({ readCapacityUnits: 0 }).avgReadUtilizationPercent).toBe(0);
  });

  it('exposes kind and wasteReason', () => {
    expect(makeTable().kind).toBe('dynamodb-overprovisioned');
    expect(makeTable().wasteReason).toContain('read');
    expect(makeTable().wasteReason).toContain('write');
  });

  it('costEstimate returns the stored monthlyCostUsd', () => {
    expect(makeTable().costEstimate.monthlyCostUsd).toBe(12.5);
  });
});
