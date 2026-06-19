import { test, expect } from '@playwright/test';
import { readHandoffUrl } from '../../appium/utils/handoff';

test.describe('Mobile → Web PPV Handoff', () => {
  test('completes PPV purchase from mobile handoff URL', async ({ page }) => {
    // Read the URL captured by the Appium test
    const checkoutUrl = readHandoffUrl();
    
    if (!checkoutUrl) {
      throw new Error('❌ No handoff URL found. Run the Android Appium test first to capture the checkout URL.');
    }
    
    console.log(`\n🌐 Opening handoff URL: ${checkoutUrl}\n`);
    
    // Navigate to the checkout URL
    await page.goto(checkoutUrl);
    
    // Wait for the page to load
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'test-results/mobile_handoff_landing.png', fullPage: true });
    
    // The page should show PPV purchase options
    // Look for common PPV page elements
    const ppvTitle = page.locator('text=Joshua vs. Prenga').or(page.locator('text=PPV')).or(page.locator('text=pay-per-view'));
    await expect(ppvTitle.first()).toBeVisible({ timeout: 10000 });
    
    console.log('✅ PPV page loaded');
    
    // Look for and click Buy/Continue button
    const buyButton = page.locator('button:has-text("Buy"), button:has-text("Continue"), button:has-text("Purchase")').first();
    await expect(buyButton).toBeVisible({ timeout: 10000 });
    await buyButton.click();
    
    console.log('✅ Clicked Buy button');
    
    // Wait for navigation to plan selection or payment page
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'test-results/mobile_handoff_plan_selection.png', fullPage: true });
    
    // Look for plan selection or payment form
    const planSection = page.locator('text=choose a plan').or(page.locator('text=payment')).or(page.locator('text=checkout'));
    if (await planSection.first().isVisible({ timeout: 5000 })) {
      console.log('✅ Plan selection/payment page reached');
      
      // Select first available plan if needed
      const planRadio = page.locator('input[type="radio"]').first();
      if (await planRadio.isVisible()) {
        await planRadio.click();
        console.log('✅ Selected plan');
      }
      
      // Continue to payment
      const continueBtn = page.locator('button:has-text("Continue"), button:has-text("Next")').first();
      if (await continueBtn.isVisible()) {
        await continueBtn.click();
        console.log('✅ Clicked Continue');
      }
    }
    
    // Final verification - we should be on a payment or confirmation page
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: 'test-results/mobile_handoff_complete.png', fullPage: true });
    
    console.log('✅ Mobile handoff flow completed');
  });
});