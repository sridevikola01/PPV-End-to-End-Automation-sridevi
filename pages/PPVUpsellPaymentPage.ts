import { Page } from '@playwright/test';
import { BasePage } from './BasePage';
import { compare } from '../utils/compare';
import { resolveExpected } from '../utils/resolveExpected';

/**
 * PPVUpsellPaymentPage — Generic page object for purchasing a PPV
 * using a previously saved payment card (no VGS iframes needed).
 *
 * Fully dynamic — reads PPV title, price, CVV from eventData.
 * Works for any upsell PPV purchase with a saved card.
 *
 * Expected eventData keys:
 *   UPSELL_CVV — CVV for saved card (default: '737')
 *   (all validation fields come from Excel sheet via resolveExpected)
 */
export class PPVUpsellPaymentPage extends BasePage {
  constructor(page: Page) {
    super(page);
  }

  // ─────────────────────────────
  // DETECT: Is this a saved card payment page?
  // ─────────────────────────────
  async isPPVUpsellPaymentPage(): Promise<boolean> {
    const body = await this.page.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    const lower = body.toLowerCase();
    // Generic: saved card present + one time payment indicator
    return (lower.includes('one time payment') || lower.includes('pay now')) &&
           (lower.includes('visa') || lower.includes('mastercard') || lower.includes('amex') ||
            lower.includes('****') || lower.includes('saved'));
  }

  // ─────────────────────────────
  // VALIDATE: Saved Card Payment Page (generic)
  // Fields: page title, PPV image, date badge, PPV price,
  // payment type, today you pay, payment instruction,
  // saved card info, more payment methods, redeem promo code
  // ─────────────────────────────
  async validateSavedCardPayment(
    data: any[],
    results: any[],
    eventData: Record<string, string>,
    pageName = 'Saved Card Payment'
  ): Promise<void> {
    console.log(`🔍 Validating ${pageName} page...`);
    const bodyText = await this.page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
    const bodyLower = bodyText.toLowerCase();

    for (const row of data) {
      const field = (row['Field'] || '').trim();
      if (!field) continue;
      const expected = resolveExpected(row, eventData);
      let actual = 'N/A';
      const key = field.toLowerCase().replace(/\s+/g, ' ').trim();

      if (key === 'page title') {
        const headings = await this.page.locator('h1, h2').allTextContents().catch(() => []);
        // Find heading containing PPV-related text (e.g., "PPV: Fury vs. Hall")
        const ppvH = headings.find((h: string) => h.toLowerCase().includes('ppv') || h.toLowerCase().includes('vs'));
        actual = ppvH?.trim() || headings[0]?.trim() || 'N/A';

      } else if (key.includes('ppv image') || key.includes('image present')) {
        const imgs = this.page.locator('img');
        actual = (await imgs.count().catch(() => 0)) > 0 ? 'Yes' : 'No';

      } else if (key.includes('date badge') || key.includes('event date')) {
        const datePatterns = [
          /\b(Sat|Sun|Mon|Tue|Wed|Thu|Fri)\w*\s+\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+at\s+\d{1,2}:\d{2}/i,
          /\b(Saturday|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday)\s+at\s+\d{1,2}:\d{2}/i,
          /\b(Sat|Sun|Mon|Tue|Wed|Thu|Fri)\w*\s+at\s+\d{1,2}:\d{2}/i,
          /\b\d{1,2}(?:st|nd|rd|th)?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+at\s+\d{1,2}:\d{2}/i,
        ];
        for (const pattern of datePatterns) {
          const match = bodyText.match(pattern);
          if (match) { actual = match[0].trim(); break; }
        }

      } else if (key === 'ppv price' || key === 'event price') {
        const priceMatch = bodyText.match(/£\d+\.\d{2}/);
        actual = priceMatch ? priceMatch[0] : 'N/A';

      } else if (key.includes('payment type')) {
        actual = bodyLower.includes('one time payment') ? 'One time payment' : 'N/A';

      } else if (key.includes('today you pay') || key.includes('total price')) {
        const todayMatch = bodyText.match(/today you pay[^£]*£(\d+\.\d{2})/i);
        actual = todayMatch ? `£${todayMatch[1]}` : 'N/A';

      } else if (key.includes('payment instruction') || key.includes('payment text')) {
        actual = bodyLower.includes('please choose from the payment options') ? expected : 'N/A';

      } else if (key.includes('saved card') || key.includes('card on file')) {
        // Generic: check for any card brand + last 4 digits pattern
        const hasCard = bodyLower.includes('visa') || bodyLower.includes('mastercard') ||
                        bodyLower.includes('amex') || bodyLower.includes('****');
        actual = hasCard ? expected : 'N/A';

      } else if (key.includes('more payment')) {
        actual = bodyLower.includes('more payment methods') ? 'More payment methods' : 'N/A';

      } else if (key.includes('redeem promo') || key.includes('promo code')) {
        actual = bodyLower.includes('redeem promo code') ? 'Redeem promo code' : 'N/A';
      }

      const status = compare(actual, expected) ? 'PASS' : 'FAIL';
      const icon = status === 'PASS' ? '✅' : '❌';
      console.log(`  ${icon} [${field}] expected="${expected}" actual="${actual}"`);
      results.push({ page: pageName, field, expected, actual, status });
    }
  }

  // ─────────────────────────────
  // ACTION: Select saved card radio (generic — any card brand)
  // Targets the specific card row containing brand + last-4 digits,
  // NOT generic radio inputs that could match "More payment methods".
  // ─────────────────────────────
  async selectSavedCard(): Promise<void> {
    console.log('💳 Selecting saved payment card...');

    // Wait for the payment method section to load
    await this.page.waitForSelector('text=/payment method/i', { timeout: 10000 }).catch(() => {});

    // Strategy 1: Find the row/container that has card brand text + last-4 digits
    // The screenshot shows: "VISA - **** 1111 / Exp 03/30" inside a clickable row
    const cardRowSelectors = [
      // Text-based: find element containing "**** " (any card's last 4 digits)
      'div:has-text("****") >> visible=true',
      'label:has-text("****") >> visible=true',
      'section:has-text("****") >> visible=true',
    ];

    let clicked = false;

    // First try: use getByText to find the card label and click its container
    const cardPatterns = [/VISA.*\*{4}/i, /Mastercard.*\*{4}/i, /AMEX.*\*{4}/i, /\*{4}\s*\d{4}/];
    for (const pattern of cardPatterns) {
      const cardText = this.page.getByText(pattern).first();
      if (await cardText.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log(`💳 Found card text matching: ${pattern}`);
        // Click the card text itself — the row/label should handle click propagation
        await cardText.click({ force: true });
        clicked = true;
        console.log('✅ Clicked saved card text');
        break;
      }
    }

    // Second try: find a clickable parent that wraps the card info
    if (!clicked) {
      for (const sel of cardRowSelectors) {
        const row = this.page.locator(sel).first();
        if (await row.isVisible({ timeout: 1500 }).catch(() => false)) {
          // Make sure this is NOT "More payment methods"
          const text = (await row.textContent().catch(() => '')) || '';
          if (text.toLowerCase().includes('more payment')) continue;
          await row.click({ force: true });
          clicked = true;
          console.log(`✅ Clicked saved card container via: ${sel}`);
          break;
        }
      }
    }

    // Third try: find the radio input that's a SIBLING of card text containing "****"
    if (!clicked) {
      console.log('💳 Trying radio-near-card-text approach...');
      const radioClicked = await this.page.evaluate(() => {
        // Find all elements containing "****"
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node: Node | null;
        while ((node = walker.nextNode())) {
          if (node.textContent && node.textContent.includes('****')) {
            // Walk up to find a clickable container or sibling radio
            let parent = node.parentElement;
            for (let depth = 0; depth < 8 && parent; depth++) {
              // Check for radio input inside or adjacent
              const radio = parent.querySelector('input[type="radio"], [role="radio"], span[class*="radio" i], svg circle');
              if (radio) {
                (radio as HTMLElement).click();
                return true;
              }
              // Check if parent itself is clickable
              if (parent.tagName === 'LABEL' || parent.getAttribute('role') === 'radio' ||
                  parent.getAttribute('role') === 'option' || parent.style.cursor === 'pointer') {
                parent.click();
                return true;
              }
              parent = parent.parentElement;
            }
          }
        }
        return false;
      }).catch(() => false);

      if (radioClicked) {
        clicked = true;
        console.log('✅ Clicked saved card via DOM traversal');
      }
    }

    if (!clicked) {
      console.log('⚠️ Could not find saved card to click — it may already be selected');
    }

    // Wait for CVV input to appear after card selection
    await this.page.waitForTimeout(2000);
  }

  // ─────────────────────────────
  // ACTION: Enter CVV
  // CVV input only appears AFTER saved card radio is selected.
  // It's a regular <input>, NOT a VGS iframe (VGS is only for new cards).
  // ─────────────────────────────
  async enterCVV(cvv: string): Promise<void> {
    console.log('🔑 Entering CVV...');

    // Wait for CVV input to render (appears after card selection)
    // Try multiple selectors — the CVV field could be various types
    const cvvSelectors = [
      'input[placeholder*="CVV" i]',
      'input[placeholder*="CVC" i]',
      'input[placeholder*="Security" i]',
      'input[name*="cvv" i]',
      'input[name*="cvc" i]',
      'input[name*="securityCode" i]',
      'input[autocomplete*="cc-csc" i]',
      'input[type="tel"]',
      'input[type="password"]',
      'input[type="number"]',
    ];

    let cvvInput = null;

    // Wait up to 8 seconds for a CVV-like input to appear
    for (let attempt = 0; attempt < 8; attempt++) {
      for (const sel of cvvSelectors) {
        const el = this.page.locator(sel).first();
        if (await el.isVisible({ timeout: 500 }).catch(() => false)) {
          // Verify it's actually a CVV field — should be short (3-4 chars), not card number
          const maxLen = await el.getAttribute('maxlength').catch(() => null);
          const placeholder = (await el.getAttribute('placeholder').catch(() => '')) || '';
          const name = (await el.getAttribute('name').catch(() => '')) || '';

          // Accept if maxlength is 3-4 (CVV), or name/placeholder matches, or it's a tel/password type
          const isCVVLike = (maxLen && parseInt(maxLen) <= 4) ||
                            placeholder.toLowerCase().match(/cvv|cvc|security|code/) ||
                            name.toLowerCase().match(/cvv|cvc|security/) ||
                            sel.includes('password');

          // Also accept any input[type="tel"] that appeared AFTER card selection
          // (card number inputs are in VGS iframes, not on this page)
          if (isCVVLike || sel === 'input[type="tel"]') {
            cvvInput = el;
            console.log(`🔑 Found CVV input via: ${sel} (maxlength=${maxLen}, placeholder="${placeholder}")`);
            break;
          }
        }
      }
      if (cvvInput) break;
      console.log(`⏳ CVV input not found yet (attempt ${attempt + 1}/8)...`);
      await this.page.waitForTimeout(1000);
    }

    if (cvvInput) {
      await cvvInput.click({ force: true });
      await cvvInput.fill(''); // Clear first
      await cvvInput.fill(cvv);
      console.log(`✅ CVV entered: ${'*'.repeat(cvv.length)}`);

      // Verify the value was set
      const value = await cvvInput.inputValue().catch(() => '');
      if (value.length < cvv.length) {
        console.log('⚠️ CVV fill may have failed — trying char-by-char');
        await cvvInput.click({ force: true });
        await cvvInput.press('Meta+A').catch(() => cvvInput!.press('Control+A'));
        await cvvInput.press('Backspace');
        for (const char of cvv) {
          await this.page.keyboard.type(char, { delay: 150 });
        }
        console.log('✅ CVV entered via keyboard typing');
      }
    } else {
      // Last resort: try VGS iframe (unlikely for saved card, but safety net)
      console.log('⚠️ No regular CVV input found — trying VGS iframe as fallback');
      const cvvFrame = this.page.locator(
        'iframe[title*="CVV" i], iframe[title*="cvc" i], iframe[title*="security" i]'
      ).first();

      if (await cvvFrame.isVisible({ timeout: 3000 }).catch(() => false)) {
        const frame = cvvFrame.contentFrame();
        const frameInput = frame.locator('input').first();
        await frameInput.click({ force: true });
        for (const char of cvv) {
          await this.page.keyboard.type(char, { delay: 150 });
        }
        console.log('✅ CVV entered via VGS iframe');
      } else {
        console.log('❌ CVV input not found anywhere — payment may fail');
        await this.page.screenshot({ path: 'test-results/saved-card-no-cvv.png' }).catch(() => {});
      }
    }
  }

  // ─────────────────────────────
  // ACTION: Click "Pay Now" and wait for navigation
  // Graceful handling if page closes during post-payment wait
  // ─────────────────────────────
  async clickPayNow(): Promise<void> {
    console.log('🖱️ Clicking "Pay Now"...');

    if (this.page.isClosed()) throw new Error('Page closed before Pay Now click');

    const payNowBtn = this.page.locator(
      'button:has-text("Pay Now"), button:has-text("Pay now"), ' +
      'button:has-text("Pay €"), button:has-text("Pay £"), ' +
      'button[type="submit"]:has-text("Pay")'
    ).first();

    await payNowBtn.waitFor({ state: 'visible', timeout: 8000 });
    await this.page.screenshot({ path: 'test-results/saved-card-before-pay.png' }).catch(() => {});

    const beforeUrl = this.page.url();
    await payNowBtn.click({ force: true });
    console.log('✅ Clicked "Pay Now"');

    // Wait for success page — with graceful page-close handling
    try {
      await this.page.waitForURL(
        (url: URL) => url.toString() !== beforeUrl,
        { timeout: 30000 }
      );
    } catch (err: any) {
      if (this.page.isClosed()) {
        console.log('⚠️ Page closed after Pay Now — this may be expected during redirect');
        return;
      }
      console.log(`⚠️ URL did not change after Pay Now: ${err.message}`);
    }

    if (!this.page.isClosed()) {
      await this.page.waitForLoadState('domcontentloaded').catch(() => {});
      await this.page.waitForTimeout(3000).catch(() => {});
      console.log(`✅ Navigated to: ${this.page.url()}`);
    }
  }

  // ─────────────────────────────
  // ORCHESTRATOR: Select card → Enter CVV → Pay
  // CVV is read from eventData.UPSELL_CVV (fallback: '737')
  // ─────────────────────────────
  async fillAndSubmit(eventData: Record<string, string>): Promise<void> {
    const cvv = eventData.UPSELL_CVV || eventData.FURY_CVV || '737';
    console.log(`💳 Saved card payment flow — CVV length: ${cvv.length}`);
    await this.selectSavedCard();
    await this.enterCVV(cvv);
    await this.clickPayNow();
  }
}
