import {
  AndroidBasePage,
  AndroidFlowHooks,
  AndroidPPVSurface,
  WdBrowser,
} from './AndroidBasePage';

export interface AndroidBannerFlowOptions {
  label: string;
  pageName?: string;
  missingScreenshot: string;
  foundScreenshot: string;
  buyMissingScreenshot: string;
  validateSurface?: AndroidPPVSurface;
  immediatePaywall?: boolean;
  recordPage?: string;
}

export class AndroidLandingPage extends AndroidBasePage {
  async openBannerPaywall(options: AndroidBannerFlowOptions, hooks: AndroidFlowHooks = {}): Promise<boolean> {
    console.log(`${options.label} -> Find PPV banner -> Buy now`);
    console.log(`  Finding PPV banner for "${this.ppvName}" on ${options.pageName || options.label}...`);

    const found = await this.findBannerOnCurrentPage(this.ppvName);
    if (!found) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot(options.missingScreenshot)
        : undefined;
      hooks.recordAvailability?.(false, shot, options.recordPage);
      await hooks.generateAvailabilityFailureReport?.(`PPV banner "${this.ppvName}" not found on ${options.pageName || options.label}`);
      throw new Error(`PPV banner "${this.ppvName}" not found. See ${options.missingScreenshot}`);
    }

    hooks.recordAvailability?.(true, undefined, options.recordPage);
    console.log(`  Verified banner title: "${this.ppvName}"`);
    await this.driver.saveScreenshot(options.foundScreenshot);

    if (options.validateSurface) {
      await this.runSurfaceValidation(hooks, options.validateSurface);
    }

    console.log('  Clicking "Buy now" on the PPV banner...');
    let buyTapped = await this.tapBuyCtaWithFallback();
    if (!buyTapped) {
      console.log('  ⚠️ Buy CTA not found on first attempt. Swiping carousel to make banner active...');
      for (let i = 0; i < 6; i++) {
        await this.swipeLeft();
        buyTapped = await this.tapBuyCtaWithFallback();
        if (buyTapped) {
          console.log('  ✅ Buy CTA successfully tapped after carousel swipe!');
          break;
        }
      }
    }
    if (!buyTapped) {
      await this.driver.saveScreenshot(options.buyMissingScreenshot);
      throw new Error(`Could not tap Buy CTA on PPV banner. See ${options.buyMissingScreenshot}`);
    }

    if (!options.immediatePaywall) {
      await this.driver.pause(3000);
      console.log('  On paywall screen - will capture URL via Copy button');
    }

    return true;
  }

  async openLandingBannerPaywall(hooks: AndroidFlowHooks = {}): Promise<boolean> {
    return this.openBannerPaywall({
      label: 'Landing Page',
      pageName: 'Landing page',
      missingScreenshot: './test-results/android_landing_ppv_banner_not_found.png',
      foundScreenshot: './test-results/android_landing_ppv_banner_found.png',
      buyMissingScreenshot: './test-results/android_landing_buy_cta_not_found.png',
      validateSurface: 'PPV Banner',
      immediatePaywall: true,
      recordPage: 'Landing',
    }, hooks);
  }
}

export async function openLandingBannerPaywall(
  driver: WdBrowser,
  ppvName: string,
  hooks: AndroidFlowHooks = {},
): Promise<boolean> {
  return new AndroidLandingPage(driver, ppvName).openLandingBannerPaywall(hooks);
}
