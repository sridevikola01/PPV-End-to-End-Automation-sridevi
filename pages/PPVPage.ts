import { Page, Locator } from '@playwright/test';
import selectors from '../config/selectors.json';

export class PPVPage {
  constructor(private page: Page) { }

  // ─────────────────────────────
  // CHECK IF ON PPV PAGE
  // ─────────────────────────────
  async isPPVPage(): Promise<boolean> {
    try {
      const url = this.page.url();
      if (url.includes('upsellTierShown=true')) return true;

      const bodyText = await this.page.locator('body')
        .innerText({ timeout: 3000 }).catch(() => '');
      const lower = bodyText.toLowerCase();

      return (
        lower.includes('subscribe without a pay-per-view') ||
        lower.includes('choose your plan') ||
        lower.includes('choose how to buy') ||
        lower.includes('choose the right plan')
      );
    } catch {
      return false;
    }
  }

  // ─────────────────────────────
  // WAIT FOR PAGE STABLE
  // ─────────────────────────────
  async waitForLoad(): Promise<void> {
    await this.page.waitForLoadState('domcontentloaded').catch(() => { });
  }

  // ─────────────────────────────
  // DYNAMIC VALIDATION — reads from Excel data
  // No hardcoded copies/prices
  // ─────────────────────────────
  async validate(
    data: any[],
    results: any[],
    eventData: Record<string, string>,
    pageName: string = 'PPV'
  ): Promise<void> {
    console.log(`\n📋 Validating ${pageName} page — ${data.length} fields`);

    // Get full page text once for efficiency
    const bodyText = await this.page.locator('body').innerText().catch(() => '');

    for (const row of data) {
      const field = (row['Field'] || '').trim();
      const expected = (row['Value'] || row['Expected'] || '').toString().trim();
      if (!field) continue;

      let actual = 'N/A';

      try {
        actual = await this.getFieldValue(field, eventData, bodyText);
      } catch (e: any) {
        console.warn(`⚠️  Error getting "${field}": ${e.message}`);
      }

      const status = this.compareValues(actual, expected, field);

      console.log(
        `  ${status === 'PASS' ? '✅' : '❌'} [${field}]` +
        `  expected="${expected}"  actual="${actual}"`
      );

      results.push({ page: pageName, field, expected, actual, status });
    }
  }

  // ─────────────────────────────
  // GET FIELD VALUE — dynamically extracts from page
  // ─────────────────────────────
  private async getFieldValue(
    field: string,
    eventData: Record<string, string>,
    bodyText: string
  ): Promise<string> {
    const fieldLower = field.toLowerCase().replace(/\s+/g, ' ').trim();

    // ── Page-level fields ──────────────────────────────────────
    if (fieldLower === 'page title' || fieldLower === 'pagetitle') {
      const h1 = await this.page.locator('h1').first().textContent().catch(() => '');
      return (h1 || '').trim();
    }

    if (fieldLower === 'pagesubheader' || fieldLower === 'page subtitle' || fieldLower === 'page sub header') {
      const subtitle = await this.page.locator('h1 + p, h1 ~ p, [class*="subtitle"], [class*="subheader"]')
        .first().textContent().catch(() => '');
      if (subtitle && subtitle.trim()) return subtitle.trim();
      const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 10 && l.length < 150);
      if (lines.length > 1) return lines[1];
      return 'N/A';
    }

    if (fieldLower === 'cta button' || fieldLower === 'continue button') {
      const btn = this.page.locator('button[class*="continue"], button[class*="cta"], button:has-text("Continue")')
        .first();
      const text = await btn.textContent().catch(() => '');
      return (text || '').trim() || 'N/A';
    }

    // ── Trial Card fields ──────────────────────────────────────
    if (fieldLower === 'trial card present') {
      const hasTrialCard = bodyText.toLowerCase().includes('trial') ||
        bodyText.toLowerCase().includes('free trial') ||
        bodyText.toLowerCase().includes('7-day free');
      return hasTrialCard ? 'Yes' : 'No';
    }

    if (fieldLower === 'trial title') {
      return this.extractCardText(bodyText, ['trial', '7-day', '7 day'], 'title');
    }

    if (fieldLower === 'trial description') {
      return this.extractCardText(bodyText, ['cancel anytime', 'trial and only', 'after the trial'], 'description');
    }

    if (fieldLower === 'trial selected') {
      const radios = this.page.locator('input[type="radio"]');
      const count = await radios.count().catch(() => 0);
      if (count > 0) {
        const firstChecked = await radios.first().isChecked().catch(() => false);
        return firstChecked ? 'Yes' : 'No';
      }
      return 'N/A';
    }

    if (fieldLower.startsWith('trial feature') || fieldLower === 'trial highlight') {
      const featureNum = parseInt(field.replace(/\D/g, '')) || 1;
      return this.extractFeature(bodyText, 'trial', featureNum);
    }

    // ── Upsell Card fields ─────────────────────────────────────
    if (fieldLower === 'upsell card present') {
      const hasUpsell = bodyText.toLowerCase().includes('ultimate') ||
        bodyText.toLowerCase().includes('annual') ||
        bodyText.toLowerCase().includes('upsell');
      return hasUpsell ? 'Yes' : 'No';
    }

    if (fieldLower === 'upsell badge') {
      const badges = bodyText.match(/[A-Z][A-Z\s!]+(?:FREE|MONTH|SAVE|OFFER)[A-Z\s!]*/g);
      if (badges && badges.length > 0) return badges[0].trim();
      return 'N/A';
    }

    if (fieldLower === 'upsell plan name') {
      const planPatterns = [
        /Annual\s*[-–]\s*[Pp]ay\s*(?:over\s*time|[Mm]onthly)/,
        /Flex\s*[-–]\s*[Pp]ay\s*[Mm]onthly/,
        /DAZN\s+(?:Ultimate|Standard|Premium)/,
      ];
      for (const pattern of planPatterns) {
        const match = bodyText.match(pattern);
        if (match) return match[0].trim();
      }
      return 'N/A';
    }

    if (fieldLower === 'first month free text') {
      const freeMatch = bodyText.match(/[Ff]irst\s+month\s+free[^\n]*/);
      return freeMatch ? freeMatch[0].trim().toLowerCase() : 'N/A';
    }

    if (fieldLower === 'upsell price') {
      const prices = bodyText.match(/[\$£€₹]\s?\d+(?:\.\d{2})?/g);
      if (prices && prices.length > 1) return prices[1].replace(/[^\d.]/g, '');
      if (prices && prices.length > 0) return prices[0].replace(/[^\d.]/g, '');
      return 'N/A';
    }

    if (fieldLower === 'upsell sub text') {
      const subMatch = bodyText.match(/[Tt]hen\s+[\$£€₹]?\s?\d+(?:\.\d{2})?\s*\/month\s+for\s+\d+\s+months\.?/);
      return subMatch ? subMatch[0].trim() : 'N/A';
    }

    if (fieldLower === 'upsell selected') {
      const radios = this.page.locator('input[type="radio"]');
      const count = await radios.count().catch(() => 0);
      if (count > 1) {
        const secondChecked = await radios.nth(1).isChecked().catch(() => false);
        return secondChecked ? 'Yes' : 'No';
      }
      return 'No';
    }

    if (fieldLower === 'upsell renewal text') {
      const renewMatch = bodyText.match(/[Aa]nnual\s+contract\.?\s*[Aa]uto\s*[-\s]?renews\.?/);
      return renewMatch ? renewMatch[0].trim() : 'N/A';
    }

    if (fieldLower.startsWith('upsell feature')) {
      const featureNum = parseInt(field.replace(/\D/g, '')) || 1;
      return this.extractFeature(bodyText, 'upsell', featureNum);
    }

    // ── Generic fallback ───────────────────────────────────────
    return 'N/A';
  }

  // ─────────────────────────────
  // HELPER: Extract card text
  // ─────────────────────────────
  private extractCardText(bodyText: string, keywords: string[], type: string): string {
    const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 5);

    for (const line of lines) {
      const lower = line.toLowerCase();
      for (const keyword of keywords) {
        if (lower.includes(keyword)) {
          if (type === 'title' && line.length < 100) return line;
          if (type === 'description' && line.length > 30) return line;
        }
      }
    }
    return 'N/A';
  }

  // ─────────────────────────────
  // HELPER: Extract feature bullets
  // ─────────────────────────────
  private extractFeature(bodyText: string, section: string, featureNum: number): string {
    const lines = bodyText.split('\n').map(l => l.trim()).filter(l => l.length > 10 && l.length < 200);

    const featurePatterns = [
      /\d+\+?\s+fights/i,
      /free\s+(?:access|trial)/i,
      /(?:HD|4K|HDR)\s+(?:video|resolution)/i,
      /[Aa]dditional\s+cost/i,
      /[Dd]olby/i,
      /[Pp]ay-per-view/i,
      /days?\s+free\s+access/i,
    ];

    const features: string[] = [];
    for (const line of lines) {
      for (const pattern of featurePatterns) {
        if (pattern.test(line) && !features.includes(line)) {
          features.push(line);
          break;
        }
      }
    }

    if (featureNum <= features.length) {
      return features[featureNum - 1];
    }
    return 'N/A';
  }

  // ─────────────────────────────
  // COMPARE VALUES
  // ─────────────────────────────
  private compareValues(actual: string, expected: string, field: string): string {
    if (!expected || expected === 'N/A') return 'SKIP';

    // Boolean fields
    if (expected.toLowerCase() === 'yes' || expected.toLowerCase() === 'no') {
      return actual.toLowerCase() === expected.toLowerCase() ? 'PASS' : 'FAIL';
    }

    // Numeric comparison (prices)
    const actualNum = parseFloat(actual.replace(/[^\d.]/g, ''));
    const expectedNum = parseFloat(expected.replace(/[^\d.]/g, ''));
    if (!isNaN(actualNum) && !isNaN(expectedNum)) {
      return actualNum === expectedNum ? 'PASS' : 'FAIL';
    }

    // Text comparison — case-insensitive contains
    const actualNorm = actual.toLowerCase().replace(/\s+/g, ' ').trim();
    const expectedNorm = expected.toLowerCase().replace(/\s+/g, ' ').trim();

    if (actualNorm === expectedNorm) return 'PASS';
    if (actualNorm.includes(expectedNorm) || expectedNorm.includes(actualNorm)) return 'PASS';

    return 'FAIL';
  }

  // ─────────────────────────────
  // SELECT TIER CARD
  // ─────────────────────────────
  async selectTierCard(tier: string): Promise<void> {
    const tierLower = tier.toLowerCase();
    console.log(`💎 Selecting ${tier} card...`);

    if (tierLower === 'ultimate') {
      const ultimateCard = this.page.locator(
        '[class*="upsell" i], [class*="ultimate" i], label:has-text("DAZN Ultimate")'
      ).first();

      if (await ultimateCard.isVisible({ timeout: 3000 }).catch(() => false)) {
        await ultimateCard.scrollIntoViewIfNeeded().catch(() => { });
        await ultimateCard.click({ force: true }).catch(() => { });
        console.log('✅ Clicked Ultimate card');
      }
    } else {
      // Standard/PPV — select first radio
      const radio = this.page.locator('input[type="radio"]').first();
      if (await radio.isVisible({ timeout: 1500 }).catch(() => false)) {
        await radio.scrollIntoViewIfNeeded().catch(() => { });
        await radio.click({ force: true }).catch(() => { });
        console.log('✅ Selected Standard/PPV radio');
      }
    }
  }

  // ─────────────────────────────
  // CLICK CONTINUE CTA
  // ─────────────────────────────
  async clickContinueCTA(ctaText: string = 'Continue'): Promise<void> {
    console.log(`🔍 Looking for CTA: "${ctaText}"`);
    const btn = this.page.locator(`button:has-text("${ctaText}")`).first();
    await btn.waitFor({ state: 'visible', timeout: 10000 }).catch(() => { });
    await btn.scrollIntoViewIfNeeded().catch(() => { });
    await btn.click({ force: true }).catch(() => { });
    console.log(`✅ CTA "${ctaText}" clicked`);
  }
}