import { Page, Locator } from '@playwright/test';
import { BasePage } from './BasePage';
import selectors from '../config/selectors.json';

export class SignupPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ─────────────────────────────
  // FIND EMAIL INPUT
  // ─────────────────────────────
  async findEmailInput(): Promise<Locator | null> {
    const input = this.page.locator('input[type="email"]').first();
    try {
      await input.waitFor({ state: 'visible', timeout: 15000 });
      return input;
    } catch {
      return null;
    }
  }

  // ─────────────────────────────
  // ENTER EMAIL
  // ─────────────────────────────
  async enterEmail(emailValue: string) {
    const input = this.page.locator('input[type="email"]').first();

    // Single clean wait — no double waitFor
    await input.waitFor({ state: 'visible', timeout: 10000 });

    await input.click({ force: true });
    await input.press('Meta+A').catch(() => {});
    await input.press('Backspace').catch(() => {});
    await input.fill(emailValue);

    // Trigger React onChange
    await input.dispatchEvent('input');
    await input.dispatchEvent('change');

    let value = await input.inputValue();
    if (value !== emailValue) {
      console.log(`⚠️ Email fill mismatch (expected "${emailValue}", got "${value}"). Retrying with pressSequentially...`);
      await input.click({ force: true });
      await input.press('Meta+A').catch(() => {});
      await input.press('Backspace').catch(() => {});
      await input.pressSequentially(emailValue, { delay: 20 });
      await input.dispatchEvent('input');
      await input.dispatchEvent('change');
      value = await input.inputValue();
    }

    if (!value || value.length < 5) {
      throw new Error('❌ Email NOT entered properly');
    }

    console.log(`✅ Email entered: ${value}`);
  }

  // ─────────────────────────────
  // CLICK CONTINUE (EMAIL STEP)
  // ─────────────────────────────
  async clickContinue() {
    const btn = this.page.locator('button:has-text("Continue")').first();

    await btn.waitFor({ state: 'visible', timeout: 8000 });
    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ force: true });

    // Wait for SPA transition
    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
  }

  // ─────────────────────────────
  // WAIT FOR NEXT STEP
  // ─────────────────────────────
  async waitForNextStep(): Promise<'personalDetails' | 'next'> {
    const firstName = this.page.locator(selectors.signup.firstName);
    try {
      await firstName.waitFor({ state: 'visible', timeout: 5000 });
      return 'personalDetails';
    } catch {}
    return 'next';
  }

  // ─────────────────────────────
  // FILL PERSONAL DETAILS
  // ─────────────────────────────
  async fillPersonalDetails(user: any) {
    const firstName = this.page.locator(selectors.signup.firstName);
    const lastName  = this.page.locator(selectors.signup.lastName);
    const password  = this.page.locator(selectors.signup.password);

    // Wait for form to be ready
    await firstName.waitFor({ state: 'visible', timeout: 10000 });

    // Ensure page is not closed before filling
    if (this.page.isClosed()) {
      throw new Error('❌ Page closed before filling personal details');
    }

    // Fill firstName
    await firstName.click({ force: true }).catch(() => {});
    await firstName.fill(user.firstName || 'Test');
    await firstName.dispatchEvent('input');
    await firstName.dispatchEvent('change');

    // Fill lastName
    await lastName.click({ force: true }).catch(() => {});
    await lastName.fill(user.lastName  || 'User');
    await lastName.dispatchEvent('input');
    await lastName.dispatchEvent('change');

    // Fill password
    await password.click({ force: true }).catch(() => {});
    await password.fill(user.password  || 'Test@12345');
    await password.dispatchEvent('input');
    await password.dispatchEvent('change');

    // Phone number — required for Ultimate tier flows
    const phoneInput = this.page.locator(
      'input[type="tel"], input[name*="phone" i], input[name*="Phone" i], input[placeholder*="phone" i]'
    ).first();

    if (await phoneInput.isVisible({ timeout: 2000 }).catch(() => false)) {
      const isAU = this.page.url().includes('-AU');
      const targetCountry = isAU ? 'Australia' : 'United Kingdom';
      const targetDial = isAU ? '+61' : '+44';

      console.log(`🔍 Inspecting phone country code/flag status...`);
      const countrySelector = this.page.locator(
        'button[aria-label*="country" i], [class*="flag" i], [class*="country" i], [class*="dial" i], [role="combobox"], ' +
        'div.LeLwX, img[alt*="flag" i], div[tabindex="0"]'
      ).first();

      const countrySelectorVisible = await countrySelector.isVisible({ timeout: 3000 }).catch(() => false);
      if (!countrySelectorVisible) {
        throw new Error('❌ Phone country selector/flag dropdown is not visible on the signup page.');
      }

      let text = await countrySelector.innerText().catch(() => '');
      console.log(`ℹ️  Country selector text: "${text.trim()}"`);
      
      if (!text.includes(targetDial) && !text.toLowerCase().includes(targetCountry.toLowerCase())) {
        console.log(`⚠️  Dial code or flag not loaded. Clicking selector to set "${targetCountry}"...`);
        await countrySelector.click({ force: true }).catch(() => {});

        const option = this.page.locator(
          `[role="option"]:has-text("${targetCountry}"), [role="option"]:has-text("${targetDial}"), ` +
          `li:has-text("${targetCountry}"), option:has-text("${targetCountry}"), ` +
          `button:has-text("${targetCountry}"), div:has-text("${targetCountry}"), span:has-text("${targetCountry}")`
        ).first();

        if (await option.isVisible({ timeout: 2000 }).catch(() => false)) {
          await option.click({ force: true });
          console.log(`✅ Selected country option: ${targetCountry}`);
        } else {
          console.warn(`⚠️  Country option "${targetCountry}" not found in list. Dismissing dropdown.`);
          await this.page.keyboard.press('Escape').catch(() => {});
        }
      }

      // ── Verify country code and flag are fully loaded after selection ──
      const finalSelectorText = await countrySelector.innerText().catch(() => '');
      console.log(`ℹ️  Final Country selector text: "${finalSelectorText.trim()}"`);
      
      const hasDial = finalSelectorText.includes('+') || finalSelectorText.includes(targetDial);
      if (!hasDial) {
        throw new Error(`❌ Phone country dial code (${targetDial}) is missing or failed to load. Selector text: "${finalSelectorText}"`);
      }

      const flagImg = countrySelector.locator('img').first();
      const hasImg = await flagImg.count().catch(() => 0) > 0;
      if (!hasImg) {
        throw new Error('❌ Country flag image element not found in the country selector.');
      }
      const flagLoaded = await flagImg.evaluate((img: HTMLImageElement) => {
        return img.complete && img.naturalWidth > 0;
      }).catch(() => false);

      if (!flagLoaded) {
        throw new Error('❌ Country flag image is broken or failed to load on the phone input field.');
      }
      console.log('✅ Phone country code and flag verified successfully.');

      // Fill the phone number directly
      const isStag = this.page.url().includes('stag') || this.page.url().includes('dev') || this.page.url().includes('beta');
      let defaultPhone;
      if (isStag) {
        if (isAU) {
          // 04 followed by 8 random digits
          const randomDigits = Math.floor(10000000 + Math.random() * 90000000);
          defaultPhone = `04${randomDigits}`;
        } else {
          // 07 followed by 9 random digits
          const randomDigits = Math.floor(100000000 + Math.random() * 900000000);
          defaultPhone = `07${randomDigits}`;
        }
      } else {
        defaultPhone = isAU ? '0412345678' : '07480748354';
      }
      const phoneNumber = user.phone || defaultPhone;
      await phoneInput.click({ force: true });
      await phoneInput.fill(phoneNumber);
      await phoneInput.dispatchEvent('change');
      await phoneInput.blur(); // Blur to trigger validation
      console.log(`📱 Phone number entered: ${phoneNumber}`);
    }

    console.log('✅ Personal details filled');
  }

  // ─────────────────────────────
  // CLICK CONTINUE (PERSONAL DETAILS)
  // ─────────────────────────────
  async clickPersonalDetailsContinue() {
    // If the URL has already transitioned to the payment page or navigated away from personal details, skip clicking
    const url = this.page.url().toLowerCase();
    if (url.includes('payment') || !url.includes('personaldetails')) {
      console.log(`ℹ️  Already navigated away from personal details page (current URL: ${url}). Skipping Continue click.`);
      return;
    }

    const btn = this.page.locator(selectors.signup.continueButtonStep2).first();

    if (!(await btn.isVisible().catch(() => false))) {
      // Re-verify URL in case navigation completed during the timeout
      const urlPostTimeout = this.page.url().toLowerCase();
      if (urlPostTimeout.includes('payment') || !urlPostTimeout.includes('personaldetails')) {
        console.log(`ℹ️  Navigated away from personal details page during timeout (current URL: ${urlPostTimeout}). Skipping Continue click.`);
        return;
      }
      throw new Error('❌ Continue button NOT visible on personal details page');
    }

    await btn.scrollIntoViewIfNeeded().catch(() => {});
    await btn.click({ force: true });

    await this.page.waitForLoadState('domcontentloaded').catch(() => {});
    console.log('✅ Personal details Continue clicked');
  }
} 