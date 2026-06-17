import { Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { validateVariant } from '../flows/validateVariant';

/**
 * DefaultSignupPage — page object for the Default Signup flow.
 *
 * This page appears when DEFAULT_SIGNUP=true and is accessed via touchpoints
 * like "Get Started" on the Home/Welcome page.
 *
 * Key difference from the normal PPV page:
 * - Normal PPV: Only "Continue with pay-per-view" CTA
 * - Default Signup: Both "Continue with pay-per-view" AND "Subscribe without a pay-per-view"
 *
 * Validates:
 * - PPV card (title, description, price, radio state)
 * - Ultimate card (title, price, badge, features)
 * - "Continue with pay-per-view" CTA
 * - "Subscribe without a pay-per-view" link
 */
export class DefaultSignupPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  /**
   * Check if the current page is a Default Signup page.
   * The distinguishing feature is the presence of BOTH
   * "Continue with pay-per-view" AND "Subscribe without a pay-per-view".
   */
  async isDefaultSignupPage(): Promise<boolean> {
    const body = await this.page.locator('body')
      .innerText({ timeout: 3000 })
      .then(t => t.toLowerCase())
      .catch(() => '');
    return (
      body.includes('continue with pay-per-view') &&
      body.includes('subscribe without a pay-per-view')
    );
  }

  /**
   * Validate Default Signup page fields against Excel data.
   * Uses the 'Default Signup Page' sheet from the configured Excel file.
   */
  async validate(
    data: any[],
    results: any[],
    eventData: Record<string, string>,
    variant: string = 'variant1',
    flow?: string
  ): Promise<void> {
    console.log('📋 Validating Default Signup page...');
    await validateVariant(
      this.page,
      variant,
      data,
      results,
      eventData,
      'Default Signup',
      flow
    );
  }

  /**
   * Click "Continue with pay-per-view" CTA button.
   * This proceeds with the PPV + DAZN plan purchase.
   */
  async clickContinueWithPPV(): Promise<void> {
    console.log('🖱️ [DefaultSignup] Clicking "Continue with pay-per-view"...');
    const btn = this.page.locator(
      'button:has-text("Continue with pay-per-view"), ' +
      'a:has-text("Continue with pay-per-view")'
    ).first();
    await btn.waitFor({ state: 'visible', timeout: 10000 });
    await btn.scrollIntoViewIfNeeded().catch(() => { });
    await btn.click({ force: true });
    console.log('✅ [DefaultSignup] Clicked "Continue with pay-per-view"');
  }

  /**
   * Click "Subscribe without a pay-per-view" link.
   * This skips the PPV and subscribes to DAZN only.
   */
  async clickSubscribeWithoutPPV(): Promise<void> {
    console.log('🖱️ [DefaultSignup] Clicking "Subscribe without a pay-per-view"...');
    const link = this.page.locator(
      'button:has-text("Subscribe without a pay-per-view"), ' +
      'a:has-text("Subscribe without a pay-per-view"), ' +
      '*:has-text("Subscribe without a pay-per-view"):not(div):not(section):not(main):not(body)'
    ).first();
    await link.waitFor({ state: 'visible', timeout: 10000 });
    await link.scrollIntoViewIfNeeded().catch(() => { });
    await link.click({ force: true });
    console.log('✅ [DefaultSignup] Clicked "Subscribe without a pay-per-view"');
  }
}
