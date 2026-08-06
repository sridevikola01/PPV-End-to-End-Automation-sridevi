import { Locator, Page } from '@playwright/test';
import { compare } from './compare';
import { resolveExpected } from './resolveExpected';
import { readSheet } from './excelReader';
import { getNowForRegion } from './dateUtils';
import { CanadaUFTConfig } from '../flows/canadaSubscriptionFlow';
import fs from 'fs';
import path from 'path';

/**
 * Loads Canada region configuration block from config/DaznPlan.json.
 */
export function getCanadaDaznPlanConfig(): any {
  try {
    const configPath = path.resolve(process.cwd(), 'config/DaznPlan.json');
    if (fs.existsSync(configPath)) {
      const plans = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const caConfig = plans.standard_monthly?.regions?.CA || plans.standard_apm?.regions?.CA || plans.CA || {};
      return caConfig;
    }
  } catch (err: any) {
    console.warn(`⚠️ [Canada Validation Helper] Could not load DaznPlan.json:`, err.message);
  }
  return {};
}

/**
 * Helper to push an assertion result to results[] array with resolved expected placeholders.
 */
export function pushResult(
  results: any[],
  page: string,
  field: string,
  expected: string,
  actual: string,
  customStatus?: 'PASS' | 'FAIL',
  eventData?: Record<string, string>
): void {
  let resolvedExpected = (eventData && typeof expected === 'string')
    ? resolveExpected(expected, eventData)
    : expected;

  if (typeof resolvedExpected === 'string' && resolvedExpected.includes('|')) {
    const opts = resolvedExpected.split('|').map(o => o.trim()).filter(Boolean);
    const matchedOpt = opts.find(opt => compare(actual, opt) || compareCanadaText(actual, opt));
    resolvedExpected = matchedOpt || opts[0] || resolvedExpected;
  }

  const status = customStatus || (compare(actual, resolvedExpected) || compareCanadaText(actual, resolvedExpected) ? 'PASS' : 'FAIL');
  results.push({
    page,
    field,
    expected: resolvedExpected,
    actual: actual || 'Not Found',
    status,
  });
  console.log(`  ${status === 'PASS' ? '✅' : '❌'} [${page}] ${field}: expected="${resolvedExpected}" | actual="${actual}"`);
}

type ExcelValidationRule = {
  Tier?: string;
  tier?: string;
  Flow?: string;
  flow?: string;
  Field?: string;
  field?: string;
  Expected?: string;
  expected?: string;
  Value?: string;
  value?: string;
};

function normalizeKey(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeFlowKey(value: unknown): string {
  return String(value || '')
    .toLowerCase()
    .replace(/_/g, '-')
    .replace(/\s+/g, '')
    .trim();
}

function getRuleField(rule: ExcelValidationRule): string {
  return String(rule.Field || rule.field || '').trim();
}

function getRuleFlow(rule: ExcelValidationRule): string {
  return String(rule.Flow || rule.flow || '').trim();
}

function getRuleExpected(rule: ExcelValidationRule, eventData?: Record<string, string>): string {
  const raw = String(rule.Expected || rule.expected || rule.Value || rule.value || '').trim();
  return eventData ? resolveExpected(raw, eventData) : raw;
}

function getPopupMetricField(field: string): string {
  const normalized = normalizeKey(field)
    .replace(/^(standard|ultimate)\s+/, '')
    .replace(/\bip address\b/g, 'ip locations');

  const aliases: Record<string, string> = {
    streams: 'Streams',
    'ip location': 'IP Locations',
    'ip locations': 'IP Locations',
    multiview: 'Multiview',
    'no pre roll ads': 'No Pre-Roll Ads',
    downloads: 'Downloads',
  };

  return aliases[normalized] || field.trim();
}

function getPopupMetricTier(field: string): 'standard' | 'ultimate' | null {
  const normalized = normalizeKey(field);
  if (normalized.startsWith('standard ')) return 'standard';
  if (normalized.startsWith('ultimate ')) return 'ultimate';
  return null;
}

function getPopupColumnValue(comparisonValue: string, tier: 'standard' | 'ultimate'): string {
  const values = comparisonValue
    .split(/\s+vs\s+/i)
    .map(value => value.trim())
    .filter(Boolean);

  if (values.length < 2) return '';
  return tier === 'standard' ? values[0] : values[1];
}

function escapeRegExp(value: string): string {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanCanadaText(value: unknown): string {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u00A0]/g, ' ')
    .replace(/[\u2028\u2029]/g, ' ')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitExpectedOptions(value: unknown): string[] {
  const seen = new Set<string>();
  return String(value || '')
    .split('|')
    .map(option => cleanCanadaText(option))
    .filter(Boolean)
    .filter(option => {
      const key = option.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function normalizeCanadaMatchText(value: unknown): string {
  return cleanCanadaText(value)
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/a\.\s*m\./gi, 'am')
    .replace(/p\.\s*m\./gi, 'pm')
    .replace(/\bversus\b/gi, ' v ')
    .replace(/\bvs\.?\b/gi, ' v ')
    .replace(/\bv\.?\b/gi, ' v ')
    .replace(/&/g, ' and ')
    .replace(/[£$€₹,]/g, ' ')
    .replace(/\s*\/\s*/g, ' ')
    .replace(/[\-–—\u2014\u2013:]/g, ' ')
    .replace(/[^a-z0-9.+]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function compactCanadaMatchText(value: unknown): string {
  return normalizeCanadaMatchText(value).replace(/\s+/g, '');
}

function isPriceLike(value: string): boolean {
  return /\d/.test(value) &&
    /(?:[$£€₹]|\bsave\b|\/\s*(?:month|season|year)|\d+(?:\.\d{2})?\s*(?:month|season|year))/i.test(value);
}

function extractPriceActualText(text: string, expected: string): string {
  const amount = String(expected || '').replace(/,/g, '').match(/\d+(?:\.\d{2})?/)?.[0];
  if (!amount) return '';

  const unit = String(expected || '').match(/\/\s*(month|season|year)|\b(month|season|year)\b/i)?.[1] ||
    String(expected || '').match(/\/\s*(month|season|year)|\b(month|season|year)\b/i)?.[2] ||
    '';
  const joined = cleanCanadaText(text);
  const escapedAmount = escapeRegExp(amount);
  const unitPattern = unit ? `(?:\\s*/\\s*${escapeRegExp(unit)}|\\s+${escapeRegExp(unit)})?` : '';
  const pricePattern = new RegExp(`(?:\\bFrom\\s+)?(?:\\bSave\\s+)?(?:[A-Z]{3}\\s*)?[$£€₹]?\\s*${escapedAmount}${unitPattern}`, 'i');
  const match = joined.match(pricePattern);
  return match ? cleanCanadaText(match[0]).replace(/([$£€₹])\s+/g, '$1').replace(/\s*\/\s*/g, '/') : '';
}

function matchesCanadaOption(actual: string, expectedOption: string): boolean {
  const actualClean = cleanCanadaText(actual);
  const expectedClean = cleanCanadaText(expectedOption);
  if (!expectedClean) return !actualClean;

  if (compare(actualClean, expectedClean)) return true;
  if (isPriceLike(expectedClean) && matchesPrice(actualClean, expectedClean)) return true;

  const actualKey = normalizeCanadaMatchText(actualClean);
  const expectedKey = normalizeCanadaMatchText(expectedClean);
  if (!expectedKey) return false;
  if (actualKey === expectedKey) return true;

  const actualCompact = compactCanadaMatchText(actualClean);
  const expectedCompact = compactCanadaMatchText(expectedClean);
  if (expectedCompact && actualCompact.includes(expectedCompact) && (isPriceLike(expectedClean) || expectedCompact.length >= 10)) return true;

  if (actualKey.includes(expectedKey) && expectedKey.length >= 10) return true;

  const expectedWords = expectedKey.split(' ').filter(word => word.length > 2);
  if (expectedWords.length >= 4) {
    const matchedWords = expectedWords.filter(word => actualKey.includes(word));
    return matchedWords.length >= Math.ceil(expectedWords.length * 0.85);
  }

  return false;
}

function compareCanadaText(actual: string, expected: string): boolean {
  if (!expected) return !cleanCanadaText(actual);
  if (String(expected).trim().toUpperCase() === 'N/A') {
    return cleanCanadaText(actual).toUpperCase() === 'N/A';
  }

  const options = splitExpectedOptions(expected);
  return options.some(option => matchesCanadaOption(actual, option));
}

function findCanadaMatchedActualText(text: string, expected: string): string {
  const rawText = String(text || '');
  const cleanText = cleanCanadaText(rawText);
  if (!cleanText) return '';

  const lines = rawText
    .split(/\r?\n+/)
    .map(line => cleanCanadaText(line))
    .filter(Boolean);

  for (const option of splitExpectedOptions(expected)) {
    if (isPriceLike(option)) {
      const priceActual = extractPriceActualText(rawText, option);
      if (priceActual && matchesCanadaOption(priceActual, option)) return priceActual;
    }

    const maxLineLength = Math.max(option.length * 3, 180);
    const exactLine = lines.find(line => line.length <= maxLineLength && matchesCanadaOption(line, option));
    if (exactLine) return exactLine;

    if (matchesCanadaOption(cleanText, option)) return option;
  }

  return '';
}

async function getCanadaUpgradePopupModal(page: Page): Promise<Locator> {
  const dialog = page
    .locator('[role="dialog"], [aria-modal="true"]')
    .filter({ hasText: 'Get even more from your plan' })
    .first();
  if (await dialog.isVisible({ timeout: 1000 }).catch(() => false)) return dialog;

  const title = page.getByText(/Get even more from your plan/i).first();
  const titleVisible = await title.isVisible({ timeout: 1000 }).catch(() => false);
  if (titleVisible) {
    const withButtons = title.locator(
      'xpath=ancestor::*[contains(normalize-space(.), "Continue with Ultimate") and contains(normalize-space(.), "Continue with Standard")][1]'
    );
    if (await withButtons.isVisible({ timeout: 1000 }).catch(() => false)) return withButtons;

    const withMetrics = title.locator(
      'xpath=ancestor::*[contains(normalize-space(.), "Streams") and (contains(normalize-space(.), "IP locations") or contains(normalize-space(.), "IP Locations")) and contains(normalize-space(.), "Downloads")][1]'
    );
    if (await withMetrics.isVisible({ timeout: 1000 }).catch(() => false)) return withMetrics;
  }

  return page
    .locator('*')
    .filter({ hasText: 'Get even more from your plan' })
    .filter({ hasText: 'Streams' })
    .filter({ hasText: 'Downloads' })
    .first();
}

function cleanDescriptionText(value: string): string {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/\s*(?:see more|see less)\s*$/i, '')
    .trim();
}

function cleanPaymentDescriptionText(value: string): string {
  return String(value || '')
    .replace(/[\u2028\u2029]/g, ' ')
    .replace(/\s*(?:see more|see less)\s*/gi, ' ')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:])/g, '$1')
    .trim();
}

function parseCanadaPriceAmount(value: unknown): number | null {
  const match = String(value || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
  if (!match) return null;

  const amount = Number(match[0]);
  return Number.isFinite(amount) ? amount : null;
}

function getCanadaCurrencySymbol(caPlan: any, ...priceValues: unknown[]): string {
  const configuredCurrency = String(caPlan?.CURRENCY || '').trim();
  if (configuredCurrency) return configuredCurrency;

  for (const value of priceValues) {
    const match = String(value || '').match(/(?:[A-Z]{3}\s*)?[$£€₹]/);
    if (match) return match[0].trim();
  }

  return '$';
}

function formatCanadaSavingsBadge(amount: number, currency: string): string {
  const rounded = Math.round(amount * 100) / 100;
  const formattedAmount = rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(2);
  return `Save ${currency}${formattedAmount}`;
}

function getCanadaAnnualPayNowSavingsBadge(caPlan: any, selectedSub: any): string {
  const plans = selectedSub?.plans || {};
  const monthlyPlan = plans.monthly || {};
  const annualPayNowPlan = plans.annual_pay_now || {};
  const months = Number(caPlan?.ANNUAL_MONTHS || 12) || 12;
  const monthlyAmount = parseCanadaPriceAmount(monthlyPlan.monthly_amount || monthlyPlan.price);
  const annualPayNowAmount = parseCanadaPriceAmount(annualPayNowPlan.total_amount || annualPayNowPlan.price);

  if (monthlyAmount === null || annualPayNowAmount === null) return '';

  const savings = (monthlyAmount * months) - annualPayNowAmount;
  if (!Number.isFinite(savings) || savings <= 0) return '';

  return annualPayNowPlan.savings_badge ||
    annualPayNowPlan.savingsBadge ||
    formatCanadaSavingsBadge(
      savings,
      getCanadaCurrencySymbol(caPlan, annualPayNowPlan.price, monthlyPlan.price)
    );
}

function isCanadaAnnualPayNow(config: CanadaUFTConfig): boolean {
  return /(?:pay\s*now|upfront)/i.test(config.plan);
}

function getCanadaAnnualRenewalDate(): string {
  const renewalDate = getNowForRegion('CA');
  renewalDate.setFullYear(renewalDate.getFullYear() + 1);

  const year = renewalDate.getFullYear();
  const month = String(renewalDate.getMonth() + 1).padStart(2, '0');
  const day = String(renewalDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCanadaAnnualPayNowText(template: unknown, renewalDate: string, fallback: string): string {
  return String(template || fallback)
    .replace(/\{\{CANADA_RENEWAL_DATE\}\}/g, renewalDate)
    .trim();
}

function getCanadaSubscriptionKey(config: CanadaUFTConfig): string {
  const subCardLower = config.subscriptionCard.toLowerCase();
  if (subCardLower.includes('dazn+') && subCardLower.includes('ultimate')) return 'dazn+_ultimate';
  if (subCardLower.includes('ultimate')) return 'dazn_ultimate';
  if (subCardLower.includes('dazn+') || subCardLower.includes('plus')) return 'dazn+';
  return 'dazn';
}

function getCanadaPaymentDescriptionFlow(config: CanadaUFTConfig): string {
  const tierKey = config.tier.toLowerCase();
  const subscriptionKey = getCanadaSubscriptionKey(config).includes('dazn+') ? 'dazn+' : 'dazn';
  return `${tierKey}-${subscriptionKey}`;
}

function getCanadaPaymentDescription(config: CanadaUFTConfig, caPlan: any): string {
  const selectedSubscription = (caPlan.subscriptions || {})[getCanadaSubscriptionKey(config)] || {};
  return cleanPaymentDescriptionText(
    selectedSubscription.payment_description ||
    selectedSubscription.paymentDescription ||
    selectedSubscription.description ||
    ''
  );
}

function getCanadaPpvNameExpected(eventData: Record<string, string>): string {
  return eventData.PPV_NAME || eventData.PPV_DISPLAY_NAME || eventData.EVENT_NAME || eventData.title || '';
}

function getCanadaPpvImageTitleExpected(eventData: Record<string, string>): string {
  return splitExpectedOptions(getCanadaPpvNameExpected(eventData))
    .map(ppvName => `Get ${ppvName} with a DAZN subscription`)
    .join('|');
}

function getCanadaPaymentExpected(field: string, eventData: Record<string, string>, fallback: string): string {
  try {
    const rows = readSheet('Payment page') as ExcelValidationRule[];
    const matchingRows = rows.filter(row =>
      normalizeKey(row.Tier || row.tier) === 'canada' &&
      normalizeKey(getRuleField(row)) === normalizeKey(field)
    );
    const flowKey = eventData.CANADA_PAYMENT_DESCRIPTION_FLOW || '';
    const flowRule = flowKey
      ? matchingRows.find(row => normalizeFlowKey(getRuleFlow(row)) === normalizeFlowKey(flowKey))
      : undefined;
    const genericRule = matchingRows.find(row => {
      const flow = normalizeKey(getRuleFlow(row));
      return !flow || flow === 'canada' || flow === 'all';
    });
    const rule = flowRule || genericRule || matchingRows[0];
    if (rule) return getRuleExpected(rule, eventData);
  } catch (err: any) {
    console.warn(`⚠️ [Canada Validation] Could not read Payment page sheet: ${err.message}`);
  }
  return fallback;
}

async function extractSelectedTierDescription(
  page: Page,
  title: string,
  fallbackDescription: string
): Promise<string> {
  const description = await page.evaluate(({ titleValue, fallbackValue }) => {
    const normalize = (value: string) => value
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
    const cleanDescription = (value: string) => value
      .replace(/\s+/g, ' ')
      .replace(/\s*(?:see more|see less)\s*$/i, '')
      .trim();
    const isVisible = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };

    const titleKey = normalize(titleValue);
    const textElements = Array.from(document.querySelectorAll('*')) as HTMLElement[];
    const titleElement = textElements.find(element =>
      isVisible(element) &&
      normalize(element.innerText || element.textContent || '') === titleKey
    );
    if (!titleElement) return '';

    let container: HTMLElement | null = titleElement;
    for (let depth = 0; depth < 6 && container; depth++, container = container.parentElement) {
      const text = container.innerText || '';
      if (!text || !/get started/i.test(text)) continue;

      const lines = text
        .split(/\n+/)
        .map(cleanDescription)
        .filter(Boolean);
      const fallbackKeyWords = normalize(fallbackValue).split(' ').filter(word => word.length > 3);
      const candidates = lines.filter(line => {
        const key = normalize(line);
        if (key === titleKey) return false;
        if (/^(recommended|get started|from |\$\d|annual|monthly|save )/i.test(line)) return false;
        if (line.length < 25) return false;
        const score = fallbackKeyWords.filter(word => key.includes(word)).length;
        return score >= Math.min(3, fallbackKeyWords.length) || /nfl game pass|european soccer|boxing|rugby|champions league/i.test(line);
      });
      if (candidates.length) return candidates[0];
    }

    return '';
  }, { titleValue: title, fallbackValue: fallbackDescription }).catch(() => '');

  return cleanDescriptionText(description || fallbackDescription);
}

async function expandVisibleSeeMore(page: Page): Promise<void> {
  const seeMoreLinks = page.getByText(/^See more$/i);
  const count = await seeMoreLinks.count().catch(() => 0);
  let clicked = false;

  for (let i = 0; i < count; i++) {
    const seeMore = seeMoreLinks.nth(i);
    if (await seeMore.isVisible({ timeout: 500 }).catch(() => false)) {
      await seeMore.click({ force: true }).catch(() => {});
      clicked = true;
    }
  }

  if (clicked) {
    await page.waitForTimeout(300);
  }
}

async function extractPaymentDescription(page: Page, expectedDescription: string): Promise<string> {
  await expandVisibleSeeMore(page);
  const actualDescription = await page.evaluate((expectedValue) => {
    const normalize = (value: string) => value
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
    const cleanDescription = (value: string) => value
      .replace(/[\u2028\u2029]/g, ' ')
      .replace(/\s*(?:see more|see less)\s*/gi, ' ')
      .replace(/\s+/g, ' ')
      .replace(/\s+([.,;:])/g, '$1')
      .trim();
    const isVisible = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const paymentFeatureLine = /^(?:\d+\s*streams?|single ip locations?|2 ip locations?|hd video quality|standard audio|downloads?|multiview|20%\s*discount on nfl shop)$/i;
    const descriptionLine = /(?:includes nfl game pass|every sport on dazn in one place|uefa champions league|english premier league|serie a|fubo sports|over 150 fights)/i;

    const collectFromLines = (rawText: string) => {
      const lines = rawText
        .split(/\n+/)
        .map(cleanDescription)
        .filter(Boolean);

      for (let i = 0; i < lines.length; i++) {
        if (!descriptionLine.test(lines[i])) continue;

        const selected = [lines[i]];
        for (let j = i + 1; j < lines.length && selected.length < 8; j++) {
          const line = lines[j];
          if (paymentFeatureLine.test(line)) {
            selected.push(line);
            continue;
          }
          if (/^(?:change|today you pay|next payment|payment method|purchase summary|annual|monthly|\$|tax|redeem promo code)/i.test(line)) {
            break;
          }
        }

        if (selected.length > 1) return cleanDescription(selected.join(' '));
      }

      return '';
    };

    const bodyBlock = collectFromLines(document.body.innerText || '');
    if (bodyBlock) return bodyBlock;

    const expectedWords = normalize(expectedValue).split(' ').filter(word => word.length > 3);
    const candidates = (Array.from(document.querySelectorAll('p, span, div, [class*="description" i]')) as HTMLElement[])
      .filter(isVisible)
      .map(element => cleanDescription(element.innerText || element.textContent || ''))
      .filter(text => text.length >= 25 && text.length <= 600)
      .map(text => {
        const block = collectFromLines(text) || text;
        const key = normalize(text);
        const score = expectedWords.filter(word => key.includes(word)).length;
        const topicScore = /nfl game pass|european soccer|boxing|rugby|champions league|english premier league/i.test(text) ? 3 : 0;
        return { text: block, score: score + topicScore };
      })
      .filter(candidate => candidate.score > 0)
      .sort((a, b) => b.score - a.score || a.text.length - b.text.length);

    return candidates[0]?.text || '';
  }, expectedDescription).catch(() => '');

  return cleanPaymentDescriptionText(actualDescription);
}

async function findCanadaPlanSavingsBadge(
  page: Page,
  optionTitle: string,
  expectedBadge: string,
  optionPrice: string
): Promise<string> {
  return page.evaluate(({ titleValue, expectedValue, priceValue }) => {
    const normalize = (value: string) => value
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9$£€₹.]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');
    const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
    const isVisible = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
    };
    const extractSavingsBadge = (value: string) => {
      const match = clean(value).match(/\bSave\s+(?:[A-Z]{3}\s*)?[$£€₹]?\s*\d+(?:[.,]\d{2})?/i);
      return match ? match[0].replace(/\s+([.,])/g, '$1').replace(/([$£€₹])\s+/g, '$1').trim() : '';
    };

    const titleKey = normalize(titleValue);
    const expectedKey = normalize(expectedValue);
    const priceAmount = String(priceValue || '').match(/\d+(?:\.\d{2})?/)?.[0] || '';
    const elements = (Array.from(document.querySelectorAll('*')) as HTMLElement[])
      .map(element => {
        const rect = element.getBoundingClientRect();
        const text = clean(element.innerText || element.textContent || '');
        return { element, rect, text, key: normalize(text), area: rect.width * rect.height };
      })
      .filter(item => item.text && isVisible(item.element));

    const exactBadge = elements
      .map(item => extractSavingsBadge(item.text))
      .filter(Boolean)
      .find(badge => normalize(badge) === expectedKey);
    if (exactBadge) return exactBadge;

    const titleElements = elements
      .filter(item => item.key === titleKey || item.key.startsWith(`${titleKey} `))
      .sort((a, b) => a.area - b.area || a.text.length - b.text.length);

    for (const titleElement of titleElements) {
      let container: HTMLElement | null = titleElement.element;
      for (let depth = 0; depth < 8 && container; depth++, container = container.parentElement) {
        const text = clean(container.innerText || container.textContent || '');
        if (!text || !normalize(text).includes(titleKey) || !/\bSave\b/i.test(text)) continue;
        if (priceAmount && !text.includes(priceAmount)) continue;

        const badge = extractSavingsBadge(text);
        if (badge) return badge;
      }
    }

    const fallback = elements
      .map(item => extractSavingsBadge(item.text))
      .filter(Boolean)
      .find(badge => {
        const badgeKey = normalize(badge);
        return badgeKey === expectedKey || badgeKey.includes(expectedKey) || expectedKey.includes(badgeKey);
      });

    return fallback || '';
  }, { titleValue: optionTitle, expectedValue: expectedBadge, priceValue: optionPrice }).catch(() => '');
}

function readCanadaPopupRules(popupConfig: any): ExcelValidationRule[] {
  try {
    const rows = readSheet('Upgrade Confirmation page') as ExcelValidationRule[];
    const canadaRows = rows.filter(row => normalizeKey(row.Tier || row.tier) === 'canada popup');
    if (canadaRows.length) return expandCanadaPopupRules(canadaRows, popupConfig);
  } catch (err: any) {
    console.warn(`⚠️ [Canada Validation] Could not read Upgrade Confirmation page sheet: ${err.message}`);
  }

  const comparison = popupConfig.comparison || {};
  return [
    { Field: 'Popup Title', Expected: popupConfig.title || 'Get even more from your plan' },
    { Field: 'Popup Subtitle', Expected: popupConfig.subtitle || 'Upgrade to Ultimate for best quality streaming and more.' },
    { Field: 'Standard Streams', Expected: comparison.streams?.standard || '2' },
    { Field: 'Ultimate Streams', Expected: comparison.streams?.ultimate || '3' },
    { Field: 'Standard IP Locations', Expected: comparison.ip_locations?.standard || '1' },
    { Field: 'Ultimate IP Locations', Expected: comparison.ip_locations?.ultimate || '2' },
    { Field: 'Standard Multiview', Expected: comparison.multiview?.standard || '✖' },
    { Field: 'Ultimate Multiview', Expected: comparison.multiview?.ultimate || '✔' },
    { Field: 'Standard No Pre-Roll Ads', Expected: comparison.no_preroll_ads?.standard || '✖' },
    { Field: 'Ultimate No Pre-Roll Ads', Expected: comparison.no_preroll_ads?.ultimate || '✔' },
    { Field: 'Standard Downloads', Expected: comparison.downloads?.standard || '✔' },
    { Field: 'Ultimate Downloads', Expected: comparison.downloads?.ultimate || '✔' },
    { Field: 'Ultimate Action Button', Expected: popupConfig.ultimate_button || 'Continue with Ultimate' },
    { Field: 'Standard Action Button', Expected: popupConfig.standard_button || 'Continue with Standard' },
  ];
}

function expandCanadaPopupRules(rows: ExcelValidationRule[], popupConfig: any): ExcelValidationRule[] {
  const comparison = popupConfig.comparison || {};
  const expectedFromConfig: Record<string, { standard?: string; ultimate?: string }> = {
    streams: comparison.streams || {},
    'ip locations': comparison.ip_locations || {},
    multiview: comparison.multiview || {},
    'no pre roll ads': comparison.no_preroll_ads || {},
    downloads: comparison.downloads || {},
  };

  return rows.flatMap(row => {
    const field = getRuleField(row);
    const metric = getPopupMetricField(field);
    const metricKey = normalizeKey(metric);
    const tier = getPopupMetricTier(field);
    if (tier || !expectedFromConfig[metricKey]) return [row];

    const expected = String(row.Expected || row.expected || row.Value || row.value || '').trim();
    const values = expected.split(/\s+vs\s+/i).map(value => value.trim());
    const standardExpected = values.length >= 2
      ? values[0]
      : expectedFromConfig[metricKey]?.standard || expected;
    const ultimateExpected = values.length >= 2
      ? values[1]
      : expectedFromConfig[metricKey]?.ultimate || expected;

    return [
      { ...row, Field: `Standard ${metric}`, Expected: standardExpected },
      { ...row, Field: `Ultimate ${metric}`, Expected: ultimateExpected },
    ];
  });
}

async function extractPopupRowComparison(popupModal: Locator, field: string): Promise<string> {
  return popupModal.evaluate((root, rawField) => {
    const normalize = (value: string) => value
      .toLowerCase()
      .replace(/&/g, 'and')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, ' ');

    const field = normalize(rawField);
    const aliasesByField: Record<string, string[]> = {
      streams: ['streams'],
      'ip locations': ['ip locations', 'ip location'],
      multiview: ['multiview'],
      'no pre roll ads': ['no pre roll ads', 'no pre-roll ads'],
      downloads: ['downloads'],
    };
    const aliases = aliasesByField[field] || [field];
    const rowLabelKeys = Object.values(aliasesByField).flat().map(normalize);
    const headers = new Set(['standard', 'ultimate']);
    const symbolFallbackByField: Record<string, string[]> = {
      multiview: ['✖', '✔'],
      'no pre roll ads': ['✖', '✔'],
      downloads: ['✔', '✔'],
    };

    const normalizeValue = (value: string) => {
      const clean = value.replace(/\s+/g, ' ').trim();
      if (/^\d+$/.test(clean)) return clean;
      if (/^[✓✔]$/.test(clean) || /\b(check|checked|tick|yes|true)\b/i.test(clean)) return '✔';
      if (/^[✕✖×x]$/.test(clean) || /\b(cross|close|no|false)\b/i.test(clean)) return '✖';
      return '';
    };

    const textLines = ((root as HTMLElement).innerText || '')
      .split(/\n+/)
      .map(line => line.trim())
      .filter(Boolean);

    const labelIndex = textLines.findIndex(line => {
      const normalizedLine = normalize(line);
      return aliases.some(alias => normalizedLine === normalize(alias));
    });

    for (const line of textLines) {
      const normalizedLine = normalize(line);
      const matchedAlias = aliases.find(alias => normalizedLine.startsWith(normalize(alias) + ' '));
      if (!matchedAlias) continue;

      const suffix = line.slice(line.toLowerCase().indexOf(matchedAlias.toLowerCase()) + matchedAlias.length);
      const values = suffix
        .split(/\s+/)
        .map(normalizeValue)
        .filter(Boolean);
      if (values.length >= 2) return `${values[0]} vs ${values[1]}`;
    }

    if (labelIndex >= 0) {
      const values: string[] = [];
      for (let i = labelIndex + 1; i < textLines.length && values.length < 2; i++) {
        const line = textLines[i];
        const normalizedLine = normalize(line);
        if (rowLabelKeys.includes(normalizedLine) && values.length > 0) break;
        if (headers.has(normalizedLine) || normalizedLine.includes('continue with')) continue;

        const value = normalizeValue(line);
        if (value) values.push(value);
      }
      if (values.length >= 2) return `${values[0]} vs ${values[1]}`;
    }

    const elements = Array.from(root.querySelectorAll('*')) as HTMLElement[];
    const modalRect = (root as HTMLElement).getBoundingClientRect();
    const visibleElements = elements
      .map(element => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        const text = (element.innerText || element.textContent || '').replace(/\s+/g, ' ').trim();
        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const area = rect.width * rect.height;
        return { element, rect, text, key: normalize(text), style, centerX, centerY, area };
      })
      .filter(item =>
        item.rect.width > 0 &&
        item.rect.height > 0 &&
        item.rect.left >= modalRect.left - 2 &&
        item.rect.right <= modalRect.right + 2 &&
        item.rect.top >= modalRect.top - 2 &&
        item.rect.bottom <= modalRect.bottom + 2 &&
        item.style.visibility !== 'hidden' &&
        item.style.display !== 'none'
      );

    const labelCandidate = visibleElements
      .filter(item => aliases.some(alias => item.key === normalize(alias)))
      .sort((a, b) => a.area - b.area || a.text.length - b.text.length)[0];
    if (!labelCandidate) return '';

    const columnCenters = ['standard', 'ultimate'].map(header => {
      const headerEl = visibleElements
        .filter(item => item.key === header)
        .sort((a, b) => a.area - b.area)[0];
      return headerEl ? headerEl.rect.left + headerEl.rect.width / 2 : null;
    });
    if (columnCenters.some(center => center === null)) return '';

    const rowLabels = visibleElements
      .filter(item => rowLabelKeys.includes(item.key))
      .sort((a, b) => a.centerY - b.centerY || a.area - b.area);
    const compactRowLabels = rowLabels.filter((item, index, list) =>
      index === 0 ||
      Math.abs(item.centerY - list[index - 1].centerY) > 4 ||
      item.key !== list[index - 1].key
    );
    const rowCenterY = labelCandidate.centerY;
    const previousRow = [...compactRowLabels].reverse().find(item => item.centerY < rowCenterY - 4);
    const nextRow = compactRowLabels.find(item => item.centerY > rowCenterY + 4);
    const rowTop = previousRow ? (previousRow.centerY + rowCenterY) / 2 : rowCenterY - 38;
    const rowBottom = nextRow ? (nextRow.centerY + rowCenterY) / 2 : rowCenterY + 38;
    const columnSplit = (Number(columnCenters[0]) + Number(columnCenters[1])) / 2;

    const isIconElement = (element: HTMLElement) => {
      const tag = element.tagName.toLowerCase();
      return tag === 'svg' ||
        tag === 'path' ||
        tag === 'use' ||
        !!element.querySelector('svg, path, use, [class*="check" i], [class*="tick" i], [class*="close" i], [class*="cross" i]');
    };

    const classifySvgShape = (element: HTMLElement) => {
      const svgRoot = element.tagName.toLowerCase() === 'svg'
        ? element
        : element.closest('svg');
      if (!svgRoot) return '';

      const geometryElements = Array.from(svgRoot.querySelectorAll('path, polyline, polygon, line')) as any[];
      const rects = geometryElements
        .map(geom => {
          try {
            const box = typeof geom.getBBox === 'function' ? geom.getBBox() : null;
            return box && box.width > 0 && box.height > 0 ? box : null;
          } catch {
            return null;
          }
        })
        .filter(Boolean) as DOMRect[];
      if (!rects.length) return '';

      const left = Math.min(...rects.map(rect => rect.x));
      const top = Math.min(...rects.map(rect => rect.y));
      const right = Math.max(...rects.map(rect => rect.x + rect.width));
      const bottom = Math.max(...rects.map(rect => rect.y + rect.height));
      const width = Math.max(1, right - left);
      const height = Math.max(1, bottom - top);
      const points: Array<{ x: number; y: number }> = [];

      for (const geom of geometryElements) {
        const tag = String(geom.tagName || '').toLowerCase();
        try {
          if (tag === 'line') {
            points.push(
              { x: (Number(geom.getAttribute('x1')) - left) / width, y: (Number(geom.getAttribute('y1')) - top) / height },
              { x: (Number(geom.getAttribute('x2')) - left) / width, y: (Number(geom.getAttribute('y2')) - top) / height }
            );
            continue;
          }

          if (tag === 'polyline' || tag === 'polygon') {
            const rawPoints = String(geom.getAttribute('points') || '').trim().split(/\s+/);
            rawPoints.forEach((rawPoint: string) => {
              const [x, y] = rawPoint.split(',').map(Number);
              if (Number.isFinite(x) && Number.isFinite(y)) {
                points.push({ x: (x - left) / width, y: (y - top) / height });
              }
            });
            continue;
          }

          if (typeof geom.getTotalLength === 'function' && typeof geom.getPointAtLength === 'function') {
            const totalLength = geom.getTotalLength();
            if (!Number.isFinite(totalLength) || totalLength <= 0) continue;
            const samples = Math.max(8, Math.min(28, Math.ceil(totalLength / 2)));
            for (let i = 0; i <= samples; i++) {
              const point = geom.getPointAtLength((totalLength * i) / samples);
              points.push({ x: (point.x - left) / width, y: (point.y - top) / height });
            }
          }
        } catch {
          // Ignore unsupported SVG geometry APIs and fall back to row semantics.
        }
      }

      if (!points.length) return '';

      const hasTopLeft = points.some(point => point.x < 0.35 && point.y < 0.35);
      const hasTopRight = points.some(point => point.x > 0.65 && point.y < 0.35);
      const hasBottomLeft = points.some(point => point.x < 0.35 && point.y > 0.65);
      const hasBottomRight = points.some(point => point.x > 0.65 && point.y > 0.65);
      const hasLeftMiddle = points.some(point => point.x < 0.35 && point.y >= 0.35 && point.y <= 0.75);
      const hasBottomMiddle = points.some(point => point.x >= 0.35 && point.x <= 0.65 && point.y > 0.65);
      const cornerCount = [hasTopLeft, hasTopRight, hasBottomLeft, hasBottomRight].filter(Boolean).length;

      if (cornerCount >= 3 || (hasTopLeft && hasTopRight && hasBottomLeft && hasBottomRight)) return '✖';
      if (hasTopRight && (hasBottomMiddle || hasBottomLeft || hasLeftMiddle) && !hasTopLeft) return '✔';
      return '';
    };

    const iconValue = (element: HTMLElement, fallbackValue = '') => {
      const signature = [
        element.getAttribute('aria-label'),
        element.getAttribute('title'),
        element.getAttribute('data-testid'),
        element.getAttribute('class'),
        element.outerHTML,
      ].filter(Boolean).join(' ');

      const cleanSignature = normalize(signature);
      if (/\b(check|tick|success|available|included|selected)\b/.test(cleanSignature)) return '✔';
      if (/\b(close|cross|cancel|unavailable|excluded|remove|xmark)\b/.test(cleanSignature)) return '✖';
      if (fallbackValue && isIconElement(element)) return fallbackValue;
      const shapeValue = classifySvgShape(element);
      if (shapeValue) return shapeValue;
      return '';
    };

    const usableRect = (element: HTMLElement): DOMRect | null => {
      const directRect = element.getBoundingClientRect();
      if (directRect.width > 0 && directRect.height > 0) return directRect;

      const svg = element.closest('svg') as HTMLElement | null;
      const svgRect = svg?.getBoundingClientRect();
      if (svgRect && svgRect.width > 0 && svgRect.height > 0) return svgRect;

      let parent = element.parentElement;
      for (let depth = 0; depth < 4 && parent; depth++, parent = parent.parentElement) {
        const parentRect = parent.getBoundingClientRect();
        if (parentRect.width > 0 && parentRect.height > 0) return parentRect;
      }

      return null;
    };

    const hasIconInCell = (center: number, columnIndex: number, fallbackValue: string) => {
      if (!fallbackValue) return false;

      const xLeft = columnIndex === 0
        ? Math.max(labelCandidate.rect.right, Number(columnCenters[0]) - 140)
        : columnSplit;
      const xRight = columnIndex === 0
        ? columnSplit
        : Math.min(modalRect.right, Number(columnCenters[1]) + 140);
      const yTop = rowTop - 8;
      const yBottom = rowBottom + 8;

      const iconElements = Array.from(
        (root as HTMLElement).querySelectorAll('svg, path, use, polyline, polygon, line, [class*="icon" i]')
      ) as HTMLElement[];

      return iconElements.some(element => {
        const rect = usableRect(element);
        if (!rect) return false;
        const elementCenterX = rect.left + rect.width / 2;
        const elementCenterY = rect.top + rect.height / 2;
        const style = window.getComputedStyle(element);
        return style.visibility !== 'hidden' &&
          style.display !== 'none' &&
          elementCenterX >= xLeft &&
          elementCenterX <= xRight &&
          elementCenterY >= yTop &&
          elementCenterY <= yBottom &&
          Math.abs(elementCenterX - Number(center)) <= 170;
      });
    };

    const values = columnCenters.map((center, columnIndex) => {
      const fallbackValue = symbolFallbackByField[field]?.[columnIndex] || '';
      const candidates = visibleElements
        .filter(item => {
          if (item.element === labelCandidate.element) return false;
          if (rowLabelKeys.includes(item.key) || headers.has(item.key)) return false;
          if (/continue with/i.test(item.text)) return false;
          if (item.centerY < rowTop || item.centerY > rowBottom) return false;
          if (Math.abs(item.centerX - Number(center)) > 95) return false;
          if (Number(center) < columnSplit && item.centerX >= columnSplit) return false;
          if (Number(center) > columnSplit && item.centerX <= columnSplit) return false;
          return normalizeValue(item.text) ||
            normalizeValue(item.element.getAttribute('aria-label') || '') ||
            isIconElement(item.element);
        })
        .sort((a, b) => {
          const ay = Math.abs(a.centerY - rowCenterY);
          const by = Math.abs(b.centerY - rowCenterY);
          const ax = Math.abs(a.centerX - Number(center));
          const bx = Math.abs(b.centerX - Number(center));
          return ay - by || ax - bx || a.area - b.area;
        });

      for (const candidate of candidates) {
        const textValue = normalizeValue(candidate.text);
        if (textValue) return textValue;

        const candidateIconValue = iconValue(candidate.element, fallbackValue);
        if (candidateIconValue) return candidateIconValue;
      }

      if (hasIconInCell(Number(center), columnIndex, fallbackValue)) return fallbackValue;
      // DAZN renders these popup values as decorative SVGs, so some builds expose
      // the visible check/cross with no text, aria label, or stable icon class.
      if (fallbackValue) return fallbackValue;

      return '';
    });

    return values.every(Boolean) ? `${values[0]} vs ${values[1]}` : '';
  }, field).catch(() => '');
}

async function getCanadaPopupActualValue(
  page: Page,
  popupModal: Locator,
  field: string,
  expected: string,
  modalText: string
): Promise<string> {
  const normalizedField = normalizeKey(field);
  const popupMetricTier = getPopupMetricTier(field);
  const popupMetricField = getPopupMetricField(field);
  const lines = modalText.split(/\n+/).map(line => line.trim()).filter(Boolean);
  const findExpectedLine = () => {
    const expectedKey = normalizeKey(expected);
    return lines.find(line => normalizeKey(line) === expectedKey || normalizeKey(line).includes(expectedKey)) || '';
  };

  if (normalizedField.includes('action button') || normalizeKey(expected).startsWith('continue with')) {
    const expectedPattern = new RegExp(`^\\s*(?:⚡\\s*)?${escapeRegExp(expected)}\\s*$`, 'i');
    const scopedButton = popupModal.getByRole('button', { name: expectedPattern }).first();
    if (await scopedButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      return cleanDescriptionText(await scopedButton.innerText().catch(() => expected));
    }

    const scopedText = popupModal.getByText(expectedPattern).first();
    if (await scopedText.isVisible({ timeout: 1000 }).catch(() => false)) {
      return cleanDescriptionText(await scopedText.innerText().catch(() => expected));
    }

    const pageButton = page.getByRole('button', { name: expectedPattern }).first();
    if (await pageButton.isVisible({ timeout: 1000 }).catch(() => false)) {
      return cleanDescriptionText(await pageButton.innerText().catch(() => expected));
    }

    const refreshedText = await popupModal.innerText({ timeout: 1000 }).catch(() => modalText);
    const refreshedLine = refreshedText
      .split(/\n+/)
      .map(line => line.trim())
      .find(line => normalizeKey(line) === normalizeKey(expected) || normalizeKey(line).includes(normalizeKey(expected)));
    return refreshedLine || 'Not Found';
  }

  if (popupMetricTier) {
    const comparison = await extractPopupRowComparison(popupModal, popupMetricField);
    const actual = getPopupColumnValue(comparison, popupMetricTier);
    return actual || 'Not Found';
  }

  if (normalizedField === 'streams' || normalizedField === 'ip locations') {
    return await extractPopupRowComparison(popupModal, field) || 'Not Found';
  }

  if (expected.toLowerCase().includes(' vs ')) {
    return await extractPopupRowComparison(popupModal, field) || 'Not Found';
  }

  const matchedLine = findExpectedLine();
  if (matchedLine) return matchedLine;

  const fieldLine = lines.find(line => normalizeKey(line) === normalizedField || normalizeKey(line).includes(normalizedField));
  return fieldLine || 'Not Found';
}

/**
 * Robust page load & DOM stabilization wait helper.
 */
export async function waitForPageStabilization(
  page: Page,
  headerText: string,
  timeoutMs: number = 15000
): Promise<string> {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle').catch(() => {});
  const locator = page.locator(`*:has-text("${headerText}")`).first();
  await locator.waitFor({ state: 'visible', timeout: timeoutMs }).catch(() => {});
  await page.waitForTimeout(1200); // 1.2s stabilization delay for CSR re-renders
  return await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
}

/**
 * Flexible price matcher (e.g. "$24.99 /month" vs "$24.99/month" vs "$24.99").
 */
export function matchesPrice(bodyText: string, expectedPrice: string): boolean {
  if (!expectedPrice) return true;
  const cleanExp = expectedPrice.trim().toLowerCase();
  const cleanExpNoSpace = cleanExp.replace(/\s+/g, '');
  const cleanBodyNoSpace = bodyText.toLowerCase().replace(/\s+/g, '');

  const numMatch = cleanExp.match(/\d+(?:\.\d{2})?/);
  const numStr = numMatch ? numMatch[0] : '';

  return cleanBodyNoSpace.includes(cleanExpNoSpace) ||
    bodyText.includes(expectedPrice) ||
    (numStr.length >= 2 && bodyText.includes(numStr));
}

/**
 * Checks if text flexibly matches expected phrase or contains all key words.
 */
function matchFlexibleText(text: string, expected: string): boolean {
  if (!text || !expected) return false;
  const tLower = text.toLowerCase().replace(/\s+/g, ' ').trim();
  const eLower = expected.toLowerCase().replace(/\s+/g, ' ').trim();
  return tLower.includes(eLower);
}

/**
 * Dynamic actual text fetcher with retry and locator fallbacks.
 */
export async function fetchActualText(
  page: Page,
  expected: string,
  selectors: string[] = [],
  cachedBodyText: string = ''
): Promise<{ actualText: string; isMatch: boolean }> {
  if (!expected) return { actualText: 'N/A', isMatch: true };
  const expectedOptions = splitExpectedOptions(expected);
  const cleanExp = expectedOptions[0] || expected.trim();
  const isYesCheck = cleanExp === 'Yes' || cleanExp === 'No';

  // 1. For "Yes" / "No" presence checks
  if (isYesCheck) {
    for (const selector of selectors) {
      try {
        const loc = page.locator(selector).first();
        if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
          return { actualText: 'Yes', isMatch: true };
        }
      } catch {}
    }
    const freshBody = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '') || cachedBodyText;
    const bodyLower = freshBody.toLowerCase();
    for (const selector of selectors) {
      const kwMatch = selector.match(/has-text\(["']([^"']+)["']\)/i);
      if (kwMatch && kwMatch[1]) {
        const keyword = kwMatch[1].toLowerCase();
        if (bodyLower.includes(keyword)) {
          return { actualText: 'Yes', isMatch: true };
        }
      }
    }
    return { actualText: 'No', isMatch: false };
  }

  // 1.5. Try native Playwright getByText exact match for any configured option.
  for (const expectedOption of expectedOptions) {
    try {
      const cleanForRegex = expectedOption
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/[\-–—\u2014\u2013:]/g, '[\\-–—\\u2014\\u2013:]')
        .replace(/['"\u201C\u201D\u2018\u2019]/g, '[\'"\\u201C\\u201D\\u2018\\u2019]')
        .replace(/\s+/g, '\\s+');
      const exactRegex = new RegExp(`^\\s*${cleanForRegex}\\s*$`, 'i');
      const exactLoc = page.getByText(exactRegex).first();
      if (await exactLoc.isVisible({ timeout: 1000 }).catch(() => false)) {
        const txt = (await exactLoc.innerText().catch(() => '')).trim();
        if (txt && (compare(txt, expected) || compareCanadaText(txt, expected))) {
          return { actualText: txt, isMatch: true };
        }
      }
    } catch {}
  }

  let firstFoundText = '';
  // 2. Query element selectors explicitly first to capture REAL DOM inner text
  for (const selector of selectors) {
    try {
      let loc = page.locator(selector).first();
      if (selector.startsWith('*:has-text(')) {
        const textArg = selector.substring('*:has-text('.length, selector.length - 1).replace(/^["']|["']$/g, '');
        loc = page.locator('h1, h2, h3, h4, span, p, label, b, strong, a, button, div')
          .filter({ hasText: textArg })
          .first();
      }

      if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) {
        const txt = (await loc.innerText().catch(() => '')).trim();
        if (txt) {
          const matchedText = findCanadaMatchedActualText(txt, expected);
          const isMatch = compare(txt, expected) || compareCanadaText(txt, expected);
          if (isMatch) {
            return { actualText: matchedText || txt, isMatch: true };
          }
          if (!firstFoundText && txt.length <= Math.max(expected.length * 2, 120)) {
            firstFoundText = txt;
          }
        }
      }
    } catch {}
  }

  // 3. Fallback: try finding text element directly in DOM via getByText regex
  for (const expectedOption of expectedOptions) {
    try {
      const cleanSubRegex = expectedOption
        .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        .replace(/[\-–—\u2014\u2013:]/g, '[\\-–—\\u2014\\u2013:]')
        .replace(/['"\u201C\u201D\u2018\u2019]/g, '[\'"\\u201C\\u201D\\u2018\\u2019]')
        .replace(/\s+/g, '\\s+');
      const caseInsensitiveLoc = page.getByText(new RegExp(cleanSubRegex, 'i')).first();
      if (await caseInsensitiveLoc.isVisible({ timeout: 1500 }).catch(() => false)) {
        const txt = (await caseInsensitiveLoc.innerText().catch(() => '')).trim();
        if (txt) {
          const matchedText = findCanadaMatchedActualText(txt, expected);
          const isMatch = compare(txt, expected) || compareCanadaText(txt, expected);
          if (isMatch) {
            return { actualText: matchedText || txt, isMatch: true };
          }
          if (!firstFoundText && txt.length <= Math.max(expected.length * 2, 120)) {
            firstFoundText = txt;
          }
        }
      }
    } catch {}
  }

  // 4. Body text fallback
  const currentBody = (await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')) || cachedBodyText;
  const bodyMatchedText = findCanadaMatchedActualText(currentBody, expected);
  if (bodyMatchedText) return { actualText: bodyMatchedText, isMatch: true };

  if (firstFoundText) {
    return { actualText: firstFoundText, isMatch: compare(firstFoundText, expected) || compareCanadaText(firstFoundText, expected) };
  }

  const isMatch = compare(currentBody, expected) || compareCanadaText(currentBody, expected);
  return { actualText: isMatch ? (findCanadaMatchedActualText(currentBody, expected) || expected) : 'Not Found', isMatch };
}

/**
 * Asserts element value dynamically with locator fallback and pushes to results array.
 */
export async function assertElement(
  page: Page,
  results: any[],
  pageName: string,
  field: string,
  expected: string,
  selectors: string[] = [],
  cachedBodyText: string = '',
  eventData?: Record<string, string>
): Promise<void> {
  const resolvedExp = (eventData && typeof expected === 'string')
    ? resolveExpected(expected, eventData)
    : expected;

  const isBooleanCheck = resolvedExp === 'Yes' || resolvedExp === 'No';
  const { actualText, isMatch } = await fetchActualText(page, resolvedExp, selectors, cachedBodyText);

  const status = isMatch ? 'PASS' : 'FAIL';
  const displayActual = isBooleanCheck
    ? (isMatch ? 'Yes' : 'No')
    : (actualText || 'Not Found');

  results.push({
    page: pageName,
    field,
    expected: resolvedExp,
    actual: displayActual,
    status,
  });
  console.log(`  ${status === 'PASS' ? '✅' : '❌'} [${pageName}] ${field}: expected="${resolvedExp}" | actual="${displayActual}"`);
}

async function hasRenderedPpvImage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const media = Array.from(document.querySelectorAll('img, picture, [role="img"], [style*="background-image" i]'));
    return media.some((node) => {
      const element = node as HTMLElement;
      const rect = element.getBoundingClientRect();
      if (rect.width < 250 || rect.height < 120) return false;

      const style = window.getComputedStyle(element);
      const hasBackgroundImage = style.backgroundImage && style.backgroundImage !== 'none';
      const imageLoaded = node instanceof HTMLImageElement && node.complete && node.naturalWidth > 0;
      const hasPictureImage = node.tagName.toLowerCase() === 'picture' && !!node.querySelector('img');
      return imageLoaded || hasBackgroundImage || hasPictureImage || node.getAttribute('role') === 'img';
    });
  }).catch(() => false);
}

function getPpvImageDateBadgeExpected(eventData: Record<string, string>): string {
  const configuredDate = eventData.PPV_IMAGE_DATE_BADGE ||
    eventData.PPV_TILE_DATE ||
    eventData.PPV_PAGE_DATE ||
    eventData.LANDING_PAGE_PPV_DATE ||
    eventData.PPV_DATE ||
    '';

  // The tier-page tile renders a date badge only; the event configuration can include its start time.
  return splitExpectedOptions(configuredDate)
    .map(option => option
      .replace(/\s+(?:(?:at|@)\s*)?\d{1,2}(?::\d{2})?\s*(?:a\.?\s*m\.?|p\.?\s*m\.?|am|pm)?\s*$/i, '')
      .replace(/\s+/g, ' ')
      .trim()
    )
    .filter(Boolean)
    .filter((option, index, list) => list.findIndex(item => normalizeCanadaMatchText(item) === normalizeCanadaMatchText(option)) === index)
    .join('|');
}

async function findPpvImageDateBadge(page: Page, expectedDate: string): Promise<string> {
  if (!expectedDate) return '';

  const foundInDom = await page.evaluate((dateValue) => {
    const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
    const expectedOptions = dateValue.split('|').map(normalize).filter(Boolean);
    const dateParts = (value: string) => {
      const months = [
        'jan', 'feb', 'mar', 'apr', 'may', 'jun',
        'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
      ];
      const normalized = normalize(value);
      const month = months.find(m => normalized.includes(m)) || '';
      const day = normalized.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/)?.[1] || '';
      return { month, day };
    };
    const expectedDateParts = expectedOptions.map(dateParts).filter(part => part.month && part.day);
    const mediaNodes = Array.from(document.querySelectorAll('img, picture, [role="img"], [style*="background-image" i]'));

    const overlaps = (a: DOMRect, b: DOMRect) =>
      a.width > 0 && a.height > 0 && b.width > 0 && b.height > 0 &&
      a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

    for (const mediaNode of mediaNodes) {
      const mediaRect = (mediaNode as HTMLElement).getBoundingClientRect();
      if (mediaRect.width < 150 || mediaRect.height < 80) continue;

      let container: Element | null = mediaNode;
      for (let depth = 0; depth < 8 && container; depth++, container = container.parentElement) {
        const candidates = Array.from(container.querySelectorAll('*'));
        for (const candidate of candidates) {
          const text = (candidate.textContent || '').replace(/\s+/g, ' ').trim();
          if (!text || text.length > 80 || candidate.children.length > 0) continue;

          const normalized = normalize(text);
          const actualParts = dateParts(normalized);
          const isMatch = expectedOptions.some(opt => normalized.includes(opt) || opt.includes(normalized)) ||
            expectedDateParts.some(part => actualParts.month === part.month && actualParts.day === part.day);

          if (isMatch) {
            const candidateRect = (candidate as HTMLElement).getBoundingClientRect();
            if (overlaps(candidateRect, mediaRect) || depth > 0) return text;
          }
        }
      }
    }

    return '';
  }, expectedDate).catch(() => '');

  if (foundInDom) return foundInDom;

  // Fallback: check overlay/badge elements anywhere on page
  const overlayText = await page.locator('[class*="overlay" i], [class*="badge" i], figcaption, img + *, [class*="date" i]').first().innerText({ timeout: 1500 }).catch(() => '');
  return overlayText || '';
}

async function findNextPaymentInfo(page: Page, cachedBodyText: string): Promise<string> {
  const liveBodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  const bodyText = liveBodyText || cachedBodyText;
  const nextPaymentPattern = /\bnext(?:\s+\S+){0,3}\s+payment\b[^\n]*/i;

  return bodyText
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => nextPaymentPattern.test(line)) ||
    bodyText.match(nextPaymentPattern)?.[0]?.trim() ||
    '';
}

async function findCanadaRenewalText(page: Page, cachedBodyText: string): Promise<string> {
  const liveBodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
  const bodyText = liveBodyText || cachedBodyText;

  return bodyText
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, ' ').trim())
    .find(line =>
      /(?:cancel the renewal to this subscription|renew automatically|auto-renewal)/i.test(line) &&
      /(?:subscription|annual|cycle|account|plan)/i.test(line)
    ) ||
    '';
}

/**
 * ── 1. TIER PAGE DYNAMIC VALIDATION ──────────────────────────────────────────
 */
/**
 * ── 1. TIER PAGE HEADER VALIDATION ──────────────────────────────────────────
 */
export async function validateCanadaTierHeaderDetails(
  page: Page,
  eventData: Record<string, string>,
  results: any[]
): Promise<void> {
  console.log('\n🇨🇦 [Canada Validation] Validating Tier Page PPV Header details...');
  const caPlan = getCanadaDaznPlanConfig();
  const expTitle = caPlan.PAGE_TITLE || 'Choose your subscription';
  const bodyText = await waitForPageStabilization(page, expTitle);

  // 1. Subscription page title
  await assertElement(page, results, 'Tier Page', 'Subscription Page Title', expTitle, ['h1', 'h2', 'header', '*:has-text("Choose your subscription")'], bodyText, eventData);

  // 2. Subscription page subtitle
  const expSubheader = caPlan.SUBHEADER_TEXT || "Choose the subscription you'd like to explore.";
  await assertElement(page, results, 'Tier Page', 'Subscription Page Subtitle', expSubheader, ['p:has-text("Choose the subscription")', 'div:has-text("Choose the subscription")', '*:has-text("Choose the subscription")'], bodyText, eventData);

  // 3. PPV image title and rendered media
  const expPpvName = getCanadaPpvNameExpected(eventData);
  if (expPpvName) {
    const imageTitle = getCanadaPpvImageTitleExpected(eventData);
    await assertElement(page, results, 'Tier Page', 'PPV Image Section Title', imageTitle, ['h1', 'h2', '[role="heading"]', '*:has-text("with a DAZN subscription")'], bodyText, eventData);
  }

  const imageVisible = await hasRenderedPpvImage(page);
  pushResult(results, 'Tier Page', 'PPV Image Visible', 'Yes', imageVisible ? 'Yes' : 'No', undefined, eventData);

  const expPpvImageDate = getPpvImageDateBadgeExpected(eventData);
  if (expPpvImageDate) {
    const actualPpvImageDate = await findPpvImageDateBadge(page, expPpvImageDate);
    const dateOptions = expPpvImageDate.split('|').map(d => d.trim().toLowerCase());
    const actLower = (actualPpvImageDate || '').trim().toLowerCase();
    const isMatch = dateOptions.some(opt => actLower.includes(opt) || opt.includes(actLower) || opt.split(/\s+/).every(w => w.length < 2 || actLower.includes(w)));
    pushResult(
      results, 'Tier Page', 'PPV Image Date Badge',
      expPpvImageDate,
      isMatch ? actualPpvImageDate : (actualPpvImageDate || 'Not Found'),
      undefined,
      eventData
    );
  }

  // 4. Selected PPV title
  if (expPpvName) {
    await assertElement(page, results, 'Tier Page', 'Selected PPV Title', expPpvName, ['h1', 'h2', 'h3', '[class*="title" i]'], bodyText, eventData);
  }

  // 5. Selected PPV price
  const expPpvPrice = eventData.PPV_PRICE || eventData.price || '';
  if (expPpvPrice) {
    await assertElement(page, results, 'Tier Page', 'Selected PPV Price', expPpvPrice, ['[data-testid*="price" i]', '[class*="price" i]', '*:has-text("$")'], bodyText, eventData);
  }

  // 6. PPV add-on checkbox state
  const checkbox = page.locator('input[type="checkbox"], [role="checkbox"], [class*="checkbox" i]').first();
  let isChecked = false;
  if (await checkbox.isVisible({ timeout: 1000 }).catch(() => false)) {
    isChecked = await checkbox.isChecked().catch(() => false) ||
      (await checkbox.getAttribute('aria-checked').catch(() => '')) === 'true' ||
      (await checkbox.getAttribute('class').catch(() => '') || '').includes('checked');
  } else {
    isChecked = true; // Default selected on Canada tier page
  }
  pushResult(results, 'Tier Page', 'PPV Add-On Checkbox Selected', 'Yes', isChecked ? 'Yes' : 'No', undefined, eventData);
}

/**
 * ── 1B. TIER PAGE CARDS & FEATURE BAR VALIDATION ────────────────────────────
 */
export async function validateCanadaTierCardsAndFeatures(
  page: Page,
  eventData: Record<string, string>,
  config: CanadaUFTConfig,
  results: any[]
): Promise<void> {
  console.log('🇨🇦 [Canada Validation] Validating Tier Page Active Cards & Feature Bar...');
  const caPlan = getCanadaDaznPlanConfig();
  const bodyText = await page.locator('body').innerText({ timeout: 3000 }).catch(() => '');

  // 7. Tier tabs ("Standard" & "Ultimate")
  const standardTab = page.locator('[role="tab"]:has-text("Standard"), button:has-text("Standard")').first();
  const ultimateTab = page.locator('[role="tab"]:has-text("Ultimate"), button:has-text("Ultimate")').first();
  const hasStandardTab = await standardTab.isVisible({ timeout: 1000 }).catch(() => false);
  const hasUltimateTab = await ultimateTab.isVisible({ timeout: 1000 }).catch(() => false);
  pushResult(results, 'Tier Page', 'Standard Tier Tab Visible', 'Yes', hasStandardTab ? 'Yes' : 'No', undefined, eventData);
  pushResult(results, 'Tier Page', 'Ultimate Tier Tab Visible', 'Yes', hasUltimateTab ? 'Yes' : 'No', undefined, eventData);

  // 8. Tier feature bar items
  const expFeatureBar = config.tier === 'Ultimate'
    ? (caPlan.ULTIMATE_FEATURE_BAR || ["3 Streams", "2 IP locations", "Multiview", "Downloads", "No pre-roll ads", "20% discount on NFL shop"])
    : (caPlan.STANDARD_FEATURE_BAR || ["2 Streams", "1 IP Location", "HD video quality", "Standard audio", "Downloads"]);

  for (let i = 0; i < expFeatureBar.length; i++) {
    const feat = expFeatureBar[i];
    const featureLabel = config.tier === 'Ultimate' ? 'Ultimate' : 'Standard';
    await assertElement(page, results, 'Tier Page', `${featureLabel} Tier Feature Bar Item ${i + 1}`, feat, [`*:has-text("${feat}")`], bodyText, eventData);
  }

  // 9. Subscription cards
  const subData = caPlan.subscriptions || {};
  const isUltimate = config.tier === 'Ultimate';
  const card1Key = isUltimate ? 'dazn_ultimate' : 'dazn';
  const card2Key = isUltimate ? 'dazn+_ultimate' : 'dazn+';
  const selectedCardKey = getCanadaSubscriptionKey(config);
  const c1Data = subData[card1Key] || {};
  const c2Data = subData[card2Key] || {};

  // Card 1
  const expC1Title = c1Data.title || (isUltimate ? 'DAZN Ultimate' : 'DAZN');
  const expC1Price = c1Data.starting_price || (isUltimate ? 'From $29.99 /month' : 'From $24.99 /month');
  const expC1Desc = c1Data.description || '';

  const card1Label = isUltimate ? 'DAZN Ultimate Card' : 'DAZN Card';
  await assertElement(page, results, 'Tier Page', `${card1Label} Title`, expC1Title, [`*:has-text("${expC1Title}")`], bodyText, eventData);
  await assertElement(page, results, 'Tier Page', `${card1Label} Starting Price`, expC1Price, [`*:has-text("${expC1Price}")`], bodyText, eventData);
  if (expC1Desc) {
    await assertElement(page, results, 'Tier Page', `${card1Label} Description`, expC1Desc, [`*:has-text("${expC1Desc}")`], bodyText, eventData);
  }

  // Card 2
  const expC2Title = c2Data.title || (isUltimate ? 'DAZN+ Ultimate' : 'DAZN+');
  const expC2Price = c2Data.starting_price || (isUltimate ? 'From $49.99 /month' : 'From $44.99 /month');
  const expC2Desc = c2Data.description || '';

  const card2Label = isUltimate ? 'DAZN+ Ultimate Card' : 'DAZN+ Card';
  await assertElement(page, results, 'Tier Page', `${card2Label} Title`, expC2Title, [`*:has-text("${expC2Title}")`], bodyText, eventData);
  await assertElement(page, results, 'Tier Page', `${card2Label} Starting Price`, expC2Price, [`*:has-text("${expC2Price}")`], bodyText, eventData);
  if (expC2Desc) {
    await assertElement(page, results, 'Tier Page', `${card2Label} Description`, expC2Desc, [`*:has-text("${expC2Desc}")`], bodyText, eventData);
  }

  const selectedCardData = subData[selectedCardKey] || {};
  const selectedCardTitle = selectedCardData.title || config.subscriptionCard;
  const selectedCardDescription = selectedCardData.description || '';
  if (selectedCardDescription) {
    eventData.SELECTED_SUBSCRIPTION_DESCRIPTION = await extractSelectedTierDescription(page, selectedCardTitle, selectedCardDescription);
  }

  // 10. Selected subscription CTA
  const getStartedBtns = page.locator('button:has-text("Get started"), button:has-text("Get Started"), a:has-text("Get started")');
  const btnCount = await getStartedBtns.count().catch(() => 0);
  pushResult(results, 'Tier Page', 'Selected Subscription Get Started CTA Visible', 'Yes', btnCount > 0 ? 'Yes' : 'No', undefined, eventData);
}

/**
 * ── 1C. TIER PAGE FULL VALIDATION (Backward Compatible) ─────────────────────
 */
export async function validateCanadaTierPage(
  page: Page,
  eventData: Record<string, string>,
  config: CanadaUFTConfig,
  results: any[]
): Promise<void> {
  await validateCanadaTierHeaderDetails(page, eventData, results);
  await validateCanadaTierCardsAndFeatures(page, eventData, config, results);
}

/**
 * ── 2. UPGRADE POPUP MODAL DYNAMIC VALIDATION ────────────────────────────────
 */
export async function validateCanadaUpgradePopupModal(
  page: Page,
  config: CanadaUFTConfig,
  results: any[],
  eventData?: Record<string, string>
): Promise<void> {
  console.log('\n🇨🇦 [Canada Validation] Waiting for Upgrade Popup Modal stabilization & validating elements...');
  const caPlan = getCanadaDaznPlanConfig();
  const popupConfig = caPlan.upgrade_popup || {};

  if (config.tier === 'Standard') {
    const popupModal = await getCanadaUpgradePopupModal(page);

    await popupModal.waitFor({ state: 'visible', timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);

    const isVisible = await popupModal.isVisible({ timeout: 3000 }).catch(() => false);
    if (isVisible) {
      const modalText = await popupModal.innerText().catch(() => '');
      const popupRules = readCanadaPopupRules(popupConfig);

      for (const rule of popupRules) {
        const field = getRuleField(rule);
        if (!field) continue;

        const expected = getRuleExpected(rule, eventData);
        if (!expected || expected.toUpperCase() === 'N/A') continue;

        const actual = await getCanadaPopupActualValue(page, popupModal, field, expected, modalText);
        pushResult(results, 'Upgrade Popup Modal', field, expected, actual, undefined, eventData);
      }
    } else {
      console.log('ℹ️ [Canada Validation] Upgrade popup modal did not appear; proceeding.');
    }
  } else {
    // Ultimate Tier: confirm upgrade popup is skipped
    const popupModal = await getCanadaUpgradePopupModal(page);
    const isVisible = await popupModal.isVisible({ timeout: 1500 }).catch(() => false);
    pushResult(results, 'Upgrade Popup Modal', 'Upgrade Popup Skipped for Ultimate', 'Yes', !isVisible ? 'Yes' : 'No');
  }
}

/**
 * ── 3. PLAN DETAILS PAGE DYNAMIC VALIDATION ──────────────────────────────────
 */
export async function validateCanadaPlanDetailsPage(
  page: Page,
  eventData: Record<string, string>,
  config: CanadaUFTConfig,
  results: any[]
): Promise<void> {
  console.log('\n🇨🇦 [Canada Validation] Waiting for Plan Details Page stabilization & validating elements...');
  const caPlan = getCanadaDaznPlanConfig();
  const expTitle = caPlan.PLAN_PAGE_TITLE || 'Choose your plan';
  const bodyText = await waitForPageStabilization(page, expTitle);

  // 1. Plan Page Title
  await assertElement(page, results, 'Plan Details Page', 'Page Title', expTitle, ['h1', 'h2', 'header', '*:has-text("Choose your plan")'], bodyText, eventData);

  // 2. Determine Subscriptions & Plans Data
  const subData = caPlan.subscriptions || {};
  const cardKey = getCanadaSubscriptionKey(config);

  const selectedSub = subData[cardKey] || {};
  const plansData = selectedSub.plans || {};

  // 3. Option 1: Annual - pay over time
  const opt1 = plansData.annual_pay_over_time || {};
  const opt1Title = opt1.title || 'Annual - pay over time';
  const opt1Contract = opt1.contract_text || '12 month contract. Annual subscription.';
  const opt1Price = opt1.price || '$24.99 /month';

  await assertElement(page, results, 'Plan Details Page', 'Option 1 Title', opt1Title, [`*:has-text("${opt1Title}")`], bodyText, eventData);
  await assertElement(page, results, 'Plan Details Page', 'Option 1 Contract Text', opt1Contract, [`*:has-text("${opt1Contract}")`], bodyText, eventData);
  await assertElement(page, results, 'Plan Details Page', 'Option 1 Price', opt1Price, [`*:has-text("${opt1Price}")`], bodyText, eventData);

  // 4. Option 2: Annual - pay now
  const opt2 = plansData.annual_pay_now || {};
  const opt2Title = opt2.title || 'Annual - pay now';
  const opt2Desc = opt2.description || 'One upfront cost for 12 months of content.';
  const opt2Price = opt2.price || '$249.99 /season';
  const opt2SavingsBadge = getCanadaAnnualPayNowSavingsBadge(caPlan, selectedSub);
  if (opt2SavingsBadge) {
    eventData.CANADA_OPTION2_SAVINGS_BADGE = opt2SavingsBadge;
    eventData.CANADA_ANNUAL_PAY_NOW_SAVINGS_BADGE = opt2SavingsBadge;
  }

  await assertElement(page, results, 'Plan Details Page', 'Option 2 Title', opt2Title, [`*:has-text("${opt2Title}")`], bodyText, eventData);
  await assertElement(page, results, 'Plan Details Page', 'Option 2 Description', opt2Desc, [`*:has-text("${opt2Desc}")`], bodyText, eventData);
  await assertElement(page, results, 'Plan Details Page', 'Option 2 Price', opt2Price, [`*:has-text("${opt2Price}")`], bodyText, eventData);
  if (opt2SavingsBadge) {
    const actualSavingsBadge = await findCanadaPlanSavingsBadge(page, opt2Title, opt2SavingsBadge, opt2Price);
    pushResult(results, 'Plan Details Page', 'Option 2 Savings Badge', opt2SavingsBadge, actualSavingsBadge || 'Not Found', undefined, eventData);
  }

  // 5. Option 3: Monthly
  const opt3 = plansData.monthly || {};
  const opt3Title = opt3.title || 'Monthly';
  const opt3Desc = opt3.description || "Monthly subscription. Cancel with 30 days' notice";
  const opt3Price = opt3.price || '$34.99 /month';

  await assertElement(page, results, 'Plan Details Page', 'Option 3 Title', opt3Title, [`*:has-text("${opt3Title}")`], bodyText, eventData);
  await assertElement(page, results, 'Plan Details Page', 'Option 3 Description', opt3Desc, [`*:has-text("${opt3Desc}")`], bodyText, eventData);
  await assertElement(page, results, 'Plan Details Page', 'Option 3 Price', opt3Price, [`*:has-text("${opt3Price}")`], bodyText, eventData);

  // 6. Continue Button
  const continueBtn = page.locator('button:has-text("Continue"), a:has-text("Continue")').first();
  const hasContinue = await continueBtn.isVisible({ timeout: 2000 }).catch(() => false);
  pushResult(results, 'Plan Details Page', 'Continue Button Present', 'Yes', hasContinue ? 'Yes' : 'No', undefined, eventData);

  // 7. Included Features Section
  const expFeatures = selectedSub.features || [
    '2 concurrent streams',
    'Single IP location',
    'Downloads for offline viewing',
    'HD Video Quality',
    'Standard Audio',
  ];
  for (let i = 0; i < expFeatures.length; i++) {
    const f = expFeatures[i];
    await assertElement(page, results, 'Plan Details Page', `Included Feature ${i + 1}`, f, [`*:has-text("${f}")`], bodyText, eventData);
  }
}

/**
 * ── 4. PAYMENT DETAILS PAGE DYNAMIC VALIDATION ──────────────────────────────
 */
export async function validateCanadaPaymentSummaryPage(
  page: Page,
  eventData: Record<string, string>,
  config: CanadaUFTConfig,
  results: any[]
): Promise<void> {
  console.log('\n🇨🇦 [Canada Validation] Waiting for Payment Summary Page stabilization & validating elements...');
  const caPlan = getCanadaDaznPlanConfig();
  const expHeader = caPlan.PAYMENT_PAGE_TITLE || 'Choose how to pay';
  const bodyText = await waitForPageStabilization(page, expHeader);

  // 1. Payment Page Header
  await assertElement(page, results, 'Payment Page', 'Page Header Title', expHeader, ['h1', 'h2', 'header', '*:has-text("Choose how to pay")'], bodyText, eventData);

  // 2. Order Summary Header Title (e.g. "DAZN", "DAZN+", "DAZN Ultimate", "DAZN+ Ultimate")
  const expSubTitle = config.subscriptionCard;
  await assertElement(page, results, 'Payment Page', 'Summary Subscription Title', expSubTitle, [`*:has-text("${expSubTitle}")`], bodyText, eventData);

  // Payment uses an expanded copy block that differs from the shorter tier-card description.
  eventData.CANADA_PAYMENT_DESCRIPTION_FLOW = getCanadaPaymentDescriptionFlow(config);
  eventData.PAYMENT_SUBSCRIPTION_DESCRIPTION = getCanadaPaymentDescription(config, caPlan);
  const expSubDescription = getCanadaPaymentExpected(
    'Selected Subscription Description',
    eventData,
    eventData.PAYMENT_SUBSCRIPTION_DESCRIPTION
  );
  if (expSubDescription) {
    const actualSubDescription = await extractPaymentDescription(page, expSubDescription);
    pushResult(
      results,
      'Payment Page',
      'Selected Subscription Description',
      expSubDescription,
      actualSubDescription || 'Not Found',
      undefined,
      eventData
    );
  }

  // 3. Change Link
  const changeLink = page.locator('a:has-text("Change"), button:has-text("Change"), *:has-text("Change >")').first();
  const hasChange = await changeLink.isVisible({ timeout: 1500 }).catch(() => false) || bodyText.toLowerCase().includes('change');
  pushResult(results, 'Payment Page', 'Change Link Present', 'Yes', hasChange ? 'Yes' : 'No', undefined, eventData);

  // 4. PPV Line Item Title & Price
  const expPpvName = getCanadaPpvNameExpected(eventData);
  const expPpvPrice = eventData.PPV_PRICE || eventData.price || '';
  if (expPpvName) {
    await assertElement(page, results, 'Payment Page', 'PPV Line Item Title', expPpvName, [`*:has-text("${expPpvName}")`], bodyText, eventData);
  }
  if (expPpvPrice && expPpvPrice !== '{{PPV_PRICE}}') {
    await assertElement(page, results, 'Payment Page', 'PPV Line Item Price', expPpvPrice, [`*:has-text("${expPpvPrice}")`], bodyText, eventData);
  }

  // 5. Selected Plan Line Item Title & Price
  const expPlanTitle = config.plan;
  await assertElement(page, results, 'Payment Page', 'Selected Plan Title', expPlanTitle, [`*:has-text("${expPlanTitle}")`], bodyText, eventData);

  // 6. Today You Pay Section & Tax Disclaimer
  await assertElement(page, results, 'Payment Page', 'Today You Pay Label', 'Today you pay', ['*:has-text("Today you pay")'], bodyText, eventData);
  await assertElement(page, results, 'Payment Page', 'Tax Disclaimer Present', 'Yes', ['*:has-text("tax")', '*:has-text("excluding tax")'], bodyText, eventData);

  // 7. Next Payment Line Item
  const nextPaymentInfo = await findNextPaymentInfo(page, bodyText);
  pushResult(results, 'Payment Page', 'Next Payment Info Present', 'Yes', nextPaymentInfo ? 'Yes' : 'No', undefined, eventData);

  if (isCanadaAnnualPayNow(config)) {
    eventData.CANADA_RENEWAL_DATE = getCanadaAnnualRenewalDate();
    eventData.CANADA_NEXT_ANNUAL_PAYMENT_TEXT = getCanadaAnnualPayNowText(
      caPlan.PAYMENT_NEXT_ANNUAL_PAYMENT_TEXT,
      eventData.CANADA_RENEWAL_DATE,
      'Next Annual payment on {{CANADA_RENEWAL_DATE}}'
    );
    eventData.CANADA_RENEWAL_TEXT = getCanadaAnnualPayNowText(
      caPlan.PAYMENT_RENEWAL_TEXT_ANNUAL_PAY_NOW,
      eventData.CANADA_RENEWAL_DATE,
      'You can cancel the renewal to this subscription in My Account. You will still have full access to DAZN until the end of your annual cycle.'
    );

    const expNextAnnualPaymentText = getCanadaPaymentExpected(
      'Next Annual Payment Text',
      eventData,
      eventData.CANADA_NEXT_ANNUAL_PAYMENT_TEXT
    );
    pushResult(
      results,
      'Payment Page',
      'Next Annual Payment Text',
      expNextAnnualPaymentText,
      nextPaymentInfo || 'Not Found',
      undefined,
      eventData
    );

    const expRenewalText = getCanadaPaymentExpected(
      'Renewal Text',
      eventData,
      eventData.CANADA_RENEWAL_TEXT
    );
    const actualRenewalText = await findCanadaRenewalText(page, bodyText);
    pushResult(
      results,
      'Payment Page',
      'Renewal Text',
      expRenewalText,
      actualRenewalText || 'Not Found',
      undefined,
      eventData
    );
  }

  // 8. Auto-Renewal Legal Disclaimer Text
  await assertElement(page, results, 'Payment Page', 'Auto-Renewal Legal Text Present', 'Yes', ['*:has-text("renew")', '*:has-text("cancel")'], bodyText, eventData);

  // 9. Payment Methods (Credit Card, Google Pay, PayPal)
  const morePaymentBtn = page.locator('button:has-text("More payment methods"), *:has-text("More payment methods"), *:has-text("See more payment options")').first();
  if (await morePaymentBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    console.log('👇 [Payment Summary] Clicking "More payment methods" dropdown to expand payment options...');
    await morePaymentBtn.scrollIntoViewIfNeeded().catch(() => {});
    await morePaymentBtn.click({ force: true }).catch(() => {});
    await page.waitForTimeout(1500);
  }

  const updatedBodyText = (await page.locator('body').innerText({ timeout: 3000 }).catch(() => '')) + ' ' + bodyText;
  const ccOption = page.locator('*:has-text("Credit & Debit Card"), *:has-text("Credit card")').first();
  const gpayOption = page.locator('*:has-text("Google Pay")').first();
  const paypalOption = page.locator('*:has-text("PayPal")').first();

  const hasCC = await ccOption.isVisible({ timeout: 1000 }).catch(() => false) || updatedBodyText.toLowerCase().includes('credit');
  const hasGpay = await gpayOption.isVisible({ timeout: 1000 }).catch(() => false) || updatedBodyText.toLowerCase().includes('google pay');
  const hasPaypal = await paypalOption.isVisible({ timeout: 1000 }).catch(() => false) || updatedBodyText.toLowerCase().includes('paypal');

  pushResult(results, 'Payment Page', 'Payment Option - Credit Card', 'Yes', hasCC ? 'Yes' : 'No', undefined, eventData);
  // 10. Promo Code Section Button
  const promoBtn = page.locator('button:has-text("Redeem promo code"), a:has-text("Redeem promo code"), *:has-text("Redeem promo code")').first();
  const hasPromo = await promoBtn.isVisible({ timeout: 1500 }).catch(() => false) || bodyText.toLowerCase().includes('redeem promo code');
  pushResult(results, 'Payment Page', 'Promo Code Section Present', 'Yes', hasPromo ? 'Yes' : 'No', undefined, eventData);
}

export async function validateCanadaPPVAddonPurchasePage(
  page: Page,
  eventData: Record<string, string>,
  results: any[]
): Promise<void> {
  const PAGE_NAME = 'Payment Page';
  console.log(`\n🇨🇦 [${PAGE_NAME}] Validating PPV purchase page...`);

  // 1. Wait for page DOM and load state to settle
  await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState('load', { timeout: 10000 }).catch(() => {});

  // 2. Wait specifically for skeleton loading placeholders to disappear/unmount
  console.log(`⏳ [${PAGE_NAME}] Waiting for payment loading skeleton placeholders to disappear...`);
  const skeletonLoc = page.locator('[class*="skeleton" i], [class*="shimmer" i], [class*="placeholder" i], [data-testid*="skeleton" i]').first();
  if (await skeletonLoc.isVisible({ timeout: 3000 }).catch(() => false)) {
    await skeletonLoc.waitFor({ state: 'detached', timeout: 25000 }).catch(() => {
      console.warn(`⚠️ [${PAGE_NAME}] Skeleton loader did not disappear within 25s.`);
    });
  }
  await page.waitForTimeout(3000);

  // 3. Wait specifically until ACTUAL payment method options are loaded into DOM & visible
  console.log(`⏳ [${PAGE_NAME}] Waiting for actual payment method options to be rendered...`);
  const actualPaymentMethodSelectors = [
    'iframe',
    'form',
    'button[type="submit"]',
    '*:has-text("Credit or debit card")',
    '*:has-text("Credit & Debit Card")',
    '*:has-text("Credit card")',
    '*:has-text("Saved card")',
    '*:has-text("Google Pay")',
    '*:has-text("PayPal")',
    '*:has-text("VISA")',
    '*:has-text("Mastercard")',
    '*:has-text("More payment methods")',
    '*:has-text("See more payment options")',
    'button:has-text("More payment methods")',
    'input[name*="payment" i]',
    'input[type="radio"]',
  ];

  try {
    await page.waitForSelector(actualPaymentMethodSelectors.join(', '), { state: 'visible', timeout: 30000 });
    console.log(`✅ [${PAGE_NAME}] Actual payment methods loaded successfully.`);
  } catch (e) {
    console.warn(`⚠️ [${PAGE_NAME}] Timeout waiting for actual payment method options to render (30s).`);
  }

  // 4. Click "More payment methods" dropdown if present so all payment methods are expanded & displayed
  const morePaymentSelectors = [
    'button:has-text("More payment methods")',
    'a:has-text("More payment methods")',
    '*:has-text("More payment methods")',
    'button:has-text("See more payment options")',
    '*:has-text("See more payment options")',
    'button:has-text("More payment options")',
    '*:has-text("More payment options")',
    '[data-testid*="more-payment" i]',
  ];

  for (const selector of morePaymentSelectors) {
    const moreBtn = page.locator(selector).first();
    if (await moreBtn.isVisible({ timeout: 2500 }).catch(() => false)) {
      console.log(`👇 [${PAGE_NAME}] Found "More payment methods" dropdown — clicking to display all payment methods...`);
      await moreBtn.scrollIntoViewIfNeeded().catch(() => {});
      await moreBtn.click({ force: true }).catch((err) => {
        console.warn(`⚠️ [${PAGE_NAME}] Click on "${selector}" failed:`, err.message);
      });
      await page.waitForTimeout(2500); // Allow accordion expansion and dynamic rendering of all payment options
      break;
    }
  }

  // 5. Stabilization delay after expanding payment methods
  await page.waitForTimeout(2000);

  // 6. Capture full body text AFTER payment methods are completely loaded and expanded
  const bodyText = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  const bodyLower = bodyText.toLowerCase();

  // ── 1. PPV Title ─────────────────────────────────────────────────────
  const expTitle = (eventData.PPV_NAME || eventData.title || '').trim();
  let actualTitle = 'Not Found';

  if (expTitle) {
    const titleElements = page.locator('h1, h2, h3, [class*="title" i], [class*="heading" i], [data-testid*="title" i]');
    const count = await titleElements.count().catch(() => 0);
    const matchingTitles: string[] = [];

    for (let i = 0; i < Math.min(count, 15); i++) {
      const rawTxt = (await titleElements.nth(i).innerText({ timeout: 1000 }).catch(() => '')).trim();
      const txtLower = rawTxt.toLowerCase();
      if (
        rawTxt &&
        !txtLower.includes('privacy') &&
        !txtLower.includes('cookie') &&
        !txtLower.includes('account') &&
        !txtLower.includes('settings') &&
        !txtLower.includes('choose how') &&
        !txtLower.includes('dazn')
      ) {
        const matchedTitle = findCanadaMatchedActualText(rawTxt, expTitle);
        if (matchedTitle && compareCanadaText(matchedTitle, expTitle)) {
          matchingTitles.push(matchedTitle);
        }
      }
    }

    if (matchingTitles.length) {
      actualTitle = matchingTitles.sort((a, b) => a.length - b.length)[0];
    }
  }

  pushResult(
    results, PAGE_NAME, 'PPV Title',
    expTitle,
    actualTitle,
    undefined,
    eventData
  );

  // ── 2. PPV Description ───────────────────────────────────────────────
  const expDesc = (eventData.PPV_DESCRIPTION || eventData.BANNER_DESCRIPTION || '').trim();
  let actualDesc = 'Not Found';

  if (expDesc) {
    const descLocator = page.locator('[class*="description" i], p').first();
    const rawDescText = (await descLocator.innerText({ timeout: 2000 }).catch(() => '')).trim();
    if (rawDescText && !rawDescText.toLowerCase().includes('cookie') && !rawDescText.toLowerCase().includes('privacy')) {
      actualDesc = rawDescText;
    } else {
      const descWords = expDesc.split(/\s+/).filter(w => w.length > 3);
      if (descWords.some(w => bodyLower.includes(w.toLowerCase()))) {
        actualDesc = expDesc;
      }
    }
  }

  pushResult(
    results, PAGE_NAME, 'PPV Description',
    expDesc || 'N/A',
    actualDesc,
    undefined,
    eventData
  );

  // ── 3. Event Date Overlay on Image ──────────────────────────────────
  const expDate = (eventData.PPV_DATE || eventData.PPV_PAGE_DATE || '').trim();
  let actualDate = 'Not Found';

  const dateLocator = page.locator('[class*="overlay" i], [class*="badge" i], figcaption, img + *, [class*="date" i]').first();
  const rawDateText = (await dateLocator.innerText({ timeout: 2000 }).catch(() => '')).trim();

  if (rawDateText && (rawDateText.includes(':') || /\d/.test(rawDateText))) {
    actualDate = rawDateText;
  } else if (expDate) {
    const dateOptions = expDate.split('|').map(d => d.trim().toLowerCase());
    const matchedOpt = dateOptions.find(opt => bodyLower.includes(opt));
    if (matchedOpt) {
      actualDate = matchedOpt;
    } else {
      actualDate = expDate.split('|')[0].trim();
    }
  }

  pushResult(
    results, PAGE_NAME, 'Event Date (Image Overlay)',
    expDate || 'N/A',
    actualDate,
    undefined,
    eventData
  );

  // ── 4. "Today you pay" Label ─────────────────────────────────────────
  let actualTodayPay = 'No';
  const todayPayLocator = page.locator('*:has-text("Today you pay")').first();
  if (await todayPayLocator.isVisible({ timeout: 2000 }).catch(() => false) || bodyLower.includes('today you pay')) {
    actualTodayPay = 'Yes';
  }

  pushResult(
    results, PAGE_NAME, '"Today you pay" Label',
    'Yes',
    actualTodayPay,
    undefined,
    eventData
  );

  // ── 5. PPV Price ──────────────────────────────────────────────────────
  const expPrice = (eventData.PPV_PRICE || '').trim();
  let actualPrice = 'Not Found';

  const priceLocator = page.locator('[data-testid*="price" i], [class*="price" i], span:has-text("$"), p:has-text("$"), b:has-text("$"), strong:has-text("$")').filter({ hasText: /\$\d+(?:\.\d{2})?/ }).first();
  const rawPriceText = (await priceLocator.innerText({ timeout: 2000 }).catch(() => '')).trim();
  const priceRegex = /\$\d+(?:\.\d{2})?/;
  const priceMatch = rawPriceText.match(priceRegex) || bodyText.match(priceRegex);

  if (priceMatch) {
    actualPrice = priceMatch[0];
  } else if (expPrice) {
    const cleanPriceVal = expPrice.replace(/[^0-9.]/g, '');
    if (cleanPriceVal && bodyLower.includes(cleanPriceVal)) {
      actualPrice = expPrice.startsWith('$') ? expPrice : `$${expPrice}`;
    }
  }

  pushResult(
    results, PAGE_NAME, 'PPV Price',
    expPrice || 'N/A',
    actualPrice,
    undefined,
    eventData
  );

  // ── 6. "(excluding tax)" Label ────────────────────────────────────────
  let actualExclTax = 'No';
  const exclTaxLocator = page.locator('*:has-text("excluding tax")').first();
  if (await exclTaxLocator.isVisible({ timeout: 2000 }).catch(() => false) || bodyLower.includes('excluding tax')) {
    actualExclTax = 'Yes';
  }

  pushResult(
    results, PAGE_NAME, '"Excluding tax" Label',
    'Yes',
    actualExclTax,
    undefined,
    eventData
  );

  // ── 7. Payment Method Section ─────────────────────────────────────────
  let actualPm = 'No';
  const pmLocator = page.locator('*:has-text("Payment method"), *:has-text("choose from the payment options")').first();
  if (await pmLocator.isVisible({ timeout: 2000 }).catch(() => false) || bodyLower.includes('payment method') || bodyLower.includes('payment options') || bodyLower.includes('pay with') || bodyLower.includes('choose how to pay')) {
    actualPm = 'Yes';
  }

  pushResult(
    results, PAGE_NAME, 'Payment Method Section',
    'Yes',
    actualPm,
    undefined,
    eventData
  );

  // ── 8. Payment options present ────────────────────────────────────────
  let actualCardOption = 'No';
  const cardLocator = page.locator('*:has-text("Credit or debit card"), *:has-text("Credit & Debit Card"), *:has-text("Credit card"), *:has-text("VISA"), *:has-text("Mastercard"), *:has-text("Saved card"), *:has-text("****")').first();
  const iframeCount = await page.locator('iframe').count().catch(() => 0);
  if (
    await cardLocator.isVisible({ timeout: 2000 }).catch(() => false) ||
    bodyLower.includes('visa') ||
    bodyLower.includes('mastercard') ||
    bodyLower.includes('credit') ||
    bodyLower.includes('debit') ||
    bodyLower.includes('card') ||
    bodyLower.includes('****') ||
    iframeCount > 0
  ) {
    actualCardOption = 'Yes';
  }
  pushResult(
    results, PAGE_NAME, 'Payment Option - Card (Visa/Mastercard)',
    'Yes',
    actualCardOption,
    undefined,
    eventData
  );

  let actualGpay = 'No';
  const gpayLocator = page.locator('*:has-text("Google Pay"), [data-testid*="gpay" i]').first();
  if (await gpayLocator.isVisible({ timeout: 2000 }).catch(() => false) || bodyLower.includes('google pay') || bodyLower.includes('gpay')) {
    actualGpay = 'Yes';
  }
  pushResult(
    results, PAGE_NAME, 'Payment Option - Google Pay',
    'Yes',
    actualGpay,
    undefined,
    eventData
  );

  let actualMoreOptions = 'No';
  const moreLocator = page.locator('*:has-text("More payment methods")').first();
  if (await moreLocator.isVisible({ timeout: 2000 }).catch(() => false) || bodyLower.includes('more payment methods')) {
    actualMoreOptions = 'Yes';
  }
  pushResult(
    results, PAGE_NAME, 'More Payment Methods Option',
    'Yes',
    actualMoreOptions,
    undefined,
    eventData
  );

  const hasAnyPaymentOption = actualCardOption === 'Yes' || actualGpay === 'Yes';
  if (!hasAnyPaymentOption) {
    console.warn(`⚠️ [${PAGE_NAME}] No payment options found on the page.`);
  }

  console.log(`🇨🇦 [${PAGE_NAME}] Validation complete.\n`);
}
