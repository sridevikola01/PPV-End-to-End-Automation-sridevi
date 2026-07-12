import { AndroidBasePage, AndroidFlowHooks, WdBrowser, WdElement, adb, adbTap, getScreenSize } from './AndroidBasePage';

export class AndroidSearchPage extends AndroidBasePage {
  async navigate(): Promise<void> {
    console.log('Navigating to Search screen...');
    await this.driver.saveScreenshot('./test-results/before_search_click.png');

    const searchSelectors = [
      'android=new UiSelector().text("Search")',
      'android=new UiSelector().description("Search")',
      'android=new UiSelector().textContains("Search")',
      'android=new UiSelector().descriptionContains("Search")',
      'android=new UiSelector().resourceIdMatches(".*search.*")',
      '//android.widget.ImageView[@content-desc="Search"]',
      '//android.widget.TextView[@content-desc="Search"]',
      '//*[@content-desc="Search"]',
      '//*[contains(@resource-id, "search")]',
    ];

    for (const selector of searchSelectors) {
      try {
        console.log(`  Trying to find Search button with selector: ${selector}`);
        const searchBtn = await this.driver.$(selector);
        if (await searchBtn.isDisplayed()) {
          console.log('  Found Search button, clicking...');
          await searchBtn.click();
          await this.driver.pause(3000);
          console.log('Search screen opened by selector');
          await this.driver.saveScreenshot('./test-results/after_search_click.png');
          return;
        }
      } catch (e: any) {
        console.log(`  Selector failed: ${e.message}`);
      }
    }

    const screenSize = getScreenSize();
    console.log(`  Screen size: ${screenSize.width}x${screenSize.height}`);

    const searchTopX = Math.round(screenSize.width * 0.90);
    const searchTopY = Math.round(screenSize.height * 0.06);
    console.log(`  Tapping top header search coordinates fallback: (${searchTopX}, ${searchTopY})`);
    adbTap(searchTopX, searchTopY);
    await this.driver.pause(3000);
    await this.driver.saveScreenshot('./test-results/after_search_top_tap.png');

    const hasInput = await this.driver.$('android=new UiSelector().className("android.widget.EditText")').isDisplayed().catch(() => false);
    if (hasInput) {
      console.log('Search screen opened via top coordinate tap');
      return;
    }

    const searchBottomX = Math.round(screenSize.width * 0.90);
    const searchBottomY = Math.round(screenSize.height * 0.92);
    console.log(`  Tapping bottom nav search coordinates fallback: (${searchBottomX}, ${searchBottomY})`);
    adbTap(searchBottomX, searchBottomY);
    await this.driver.pause(3000);
    await this.driver.saveScreenshot('./test-results/after_search_bottom_tap.png');
  }

  getPPVKeywords(searchQuery: string, ppvName = this.ppvName): string[] {
    const words = [searchQuery, ppvName];
    const candidates: string[] = [];
    for (const word of words) {
      if (!word) continue;
      const cleanWord = word.toLowerCase().replace(/[:\-–\.]/g, ' ');
      if (cleanWord.includes('vs')) {
        const parts = cleanWord.split(/\bvs\b/).map(p => p.trim());
        candidates.push(...parts);
      } else {
        candidates.push(...cleanWord.split(/\s+/).map(p => p.trim()));
      }
    }

    const keywordsSet = new Set<string>();
    for (const candidate of candidates) {
      const subWords = candidate.split(/\s+/);
      for (const subWord of subWords) {
        if (subWord.length > 2 && subWord !== 'the' && subWord !== 'vs' && subWord !== 'and') {
          keywordsSet.add(subWord);
        }
      }
    }

    const result = Array.from(keywordsSet);
    return result.length > 0 ? result : [searchQuery.toLowerCase()];
  }

  async findCorrectPPVTile(keywords: string[]): Promise<WdElement | null> {
    console.log(`Scanning TextView elements for keywords: ${JSON.stringify(keywords)}`);
    try {
      const elements = await this.driver.$$('android=new UiSelector().className("android.widget.TextView")');
      for (const el of elements) {
        const text = await el.getText().catch(() => '');
        if (!text) continue;

        const textLower = text.toLowerCase();
        const matchesQuery = keywords.every(kw => textLower.includes(kw));
        const isAncillary = [
          'press', 'weigh', 'workout', 'replay', 'highlights',
          'preview', 'promo', 'interview', 'behind the', 'episode',
          'documentary', 'face off', 'kickboxing',
        ].some(term => textLower.includes(term));

        if (matchesQuery && !isAncillary) {
          console.log(`  Found matching main event tile: "${text}"`);
          return el;
        }
      }
    } catch (e: any) {
      console.log(`  Error finding tile: ${e.message}`);
    }

    return null;
  }

  async typeSearchQuery(searchQuery: string): Promise<void> {
    const screenSize = getScreenSize();
    let searchInput = null;
    const inputSelectors = [
      'android=new UiSelector().className("android.widget.EditText")',
      'android=new UiSelector().resourceIdMatches(".*search_src_text.*")',
      'android=new UiSelector().resourceIdMatches(".*search.*")',
      '//android.widget.EditText',
      '//*[contains(@resource-id, "search")]',
    ];

    for (const selector of inputSelectors) {
      try {
        const el = await this.driver.$(selector);
        if (await el.isDisplayed()) {
          searchInput = el;
          break;
        }
      } catch {}
    }

    let searchInputSuccess = false;
    if (searchInput) {
      try {
        await searchInput.click();
        await this.driver.pause(1000);
        await searchInput.clearValue();
        await searchInput.setValue(searchQuery);
        await this.driver.pause(1500);
        searchInputSuccess = true;
      } catch (e: any) {
        console.log(`Search input interaction failed: ${e.message}. Falling back to coordinates...`);
      }
    }

    if (!searchInputSuccess) {
      console.log('Search input not found or failed, using coordinate tap fallback and ADB text typing...');
      const inputX = Math.round(screenSize.width / 2);
      const inputY = Math.round(screenSize.height * 0.06);
      adbTap(inputX, inputY);
      await this.driver.pause(1000);
      const adbText = searchQuery.replace(/\s+/g, '%s');
      adb(`shell input text "${adbText}"`);
      await this.driver.pause(1500);
    }

    console.log('Pressing Search/Enter on keyboard...');
    adb('shell input keyevent 66');
  }

  async openSearchResultPaywall(searchQuery: string, hooks: AndroidFlowHooks = {}): Promise<boolean> {
    await this.navigate();
    await this.typeSearchQuery(searchQuery);
    await this.driver.pause(4000);
    await this.driver.saveScreenshot('./test-results/android_search_results.png');

    const keywords = this.getPPVKeywords(searchQuery, this.ppvName);
    console.log(`Looking for PPV tile: "${this.ppvName}"...`);
    let ppvTile = await this.findCorrectPPVTile(keywords);

    if (!ppvTile) {
      console.log('  PPV tile not immediately visible. Swiping down search results...');
      await this.scrollDown();
      await this.driver.pause(2000);
      ppvTile = await this.findCorrectPPVTile(keywords);
    }

    if (!ppvTile) {
      const retryQuery = `${searchQuery} upcoming`;
      console.log(`PPV tile not found for "${searchQuery}". Retrying search with "${retryQuery}"...`);
      await this.navigate();
      await this.typeSearchQuery(retryQuery);
      await this.driver.pause(4000);
      await this.driver.saveScreenshot('./test-results/android_search_retry_results.png');

      ppvTile = await this.findCorrectPPVTile(keywords);
      if (!ppvTile) {
        console.log('  PPV tile not immediately visible in retry search. Swiping down results...');
        await this.scrollDown();
        await this.driver.pause(2000);
        ppvTile = await this.findCorrectPPVTile(keywords);
      }
    }

    if (!ppvTile) {
      const shot = hooks.saveScreenshot
        ? await hooks.saveScreenshot('./test-results/android_search_ppv_not_found.png')
        : undefined;
      hooks.recordAvailability?.(false, shot, 'Search');
      await hooks.generateAvailabilityFailureReport?.(`PPV "${this.ppvName}" not found in Search`);
      throw new Error(`PPV event "${this.ppvName}" not found in search results (after primary & retry search).`);
    }

    hooks.recordAvailability?.(true, undefined, 'Search');
    console.log('Found PPV tile - tapping it...');
    await this.runSurfaceValidation(hooks, 'PPV Tile');
    await ppvTile.click();
    await this.driver.pause(4000);
    await this.driver.saveScreenshot('./test-results/android_search_after_tile_click.png');

    const isUltimateUser = ['active_ultimate_apm', 'active_ultimate_upfront'].includes(String(process.env.USER_STATE || '').toLowerCase().trim());
    const isLoginFirst = String(process.env.LOGIN_FIRST || '').toLowerCase() === 'true';

    if (isUltimateUser && isLoginFirst) {
      console.log('✨ [Ultimate Active User with LOGIN_FIRST=true] Search tile clicked, navigated to fixture page. Ending flow.');
      return true;
    }

    console.log('  On paywall screen - will capture URL via Copy button');
    return true;
  }
}

export async function navigateToSearch(driver: WdBrowser): Promise<void> {
  return new AndroidSearchPage(driver).navigate();
}

export async function typeSearchQuery(driver: WdBrowser, searchQuery: string): Promise<void> {
  return new AndroidSearchPage(driver).typeSearchQuery(searchQuery);
}

export function getPPVKeywords(searchQuery: string, ppvName: string): string[] {
  return new AndroidSearchPage(null, ppvName).getPPVKeywords(searchQuery, ppvName);
}

export async function findCorrectPPVTile(driver: WdBrowser, keywords: string[]): Promise<WdElement | null> {
  return new AndroidSearchPage(driver).findCorrectPPVTile(keywords);
}

export async function openSearchResultPaywall(
  driver: WdBrowser,
  ppvName: string,
  searchQuery: string,
  hooks: AndroidFlowHooks = {},
): Promise<boolean> {
  return new AndroidSearchPage(driver, ppvName).openSearchResultPaywall(searchQuery, hooks);
}
