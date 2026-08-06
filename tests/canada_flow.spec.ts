import { test, expect } from '@playwright/test';
import { parseCanadaCommand } from '../utils/configLoader';

test.describe('Canada (CA) UFT Subscription Flow - Command Parser & Mapping', () => {

  test('Combination 1: standard-dazn+-annual-pay over time', () => {
    const config = parseCanadaCommand('standard-dazn+-annual-pay over time');
    expect(config.tier).toBe('Standard');
    expect(config.subscriptionInput).toBe('dazn+');
    expect(config.subscriptionCard).toBe('DAZN+');
    expect(config.plan).toBe('Annual - Pay over time');
  });

  test('Combination 2: standard-dazn-monthly', () => {
    const config = parseCanadaCommand('standard-dazn-monthly');
    expect(config.tier).toBe('Standard');
    expect(config.subscriptionInput).toBe('dazn');
    expect(config.subscriptionCard).toBe('DAZN');
    expect(config.plan).toBe('Monthly');
  });

  test('Combination 3: ultimate-dazn-annual-pay now', () => {
    const config = parseCanadaCommand('ultimate-dazn-annual-pay now');
    expect(config.tier).toBe('Ultimate');
    expect(config.subscriptionInput).toBe('dazn');
    expect(config.subscriptionCard).toBe('DAZN Ultimate');
    expect(config.plan).toBe('Annual - Pay now');
  });

  test('Combination 4: ultimate-dazn+-monthly', () => {
    const config = parseCanadaCommand('ultimate-dazn+-monthly');
    expect(config.tier).toBe('Ultimate');
    expect(config.subscriptionInput).toBe('dazn+');
    expect(config.subscriptionCard).toBe('DAZN+ Ultimate');
    expect(config.plan).toBe('Monthly');
  });

  test('Region check isolation logic', () => {
    const isCanadaRegion = (region: string) => region.toUpperCase() === 'CA';
    expect(isCanadaRegion('CA')).toBe(true);
    expect(isCanadaRegion('ca')).toBe(true);
    expect(isCanadaRegion('CN')).toBe(false);
    expect(isCanadaRegion('cn')).toBe(false);
    expect(isCanadaRegion('GB')).toBe(false);
    expect(isCanadaRegion('US')).toBe(false);
  });
});
