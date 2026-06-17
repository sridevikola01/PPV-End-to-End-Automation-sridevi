import { Page, Locator } from '@playwright/test';


export class MyAccountPage {
  constructor(private page: Page) { }

  async hasPPV(ppvName: string): Promise<boolean> {
    const row = await this.searchPPVInCurrentDOM(ppvName);
    return row !== null;
  }

  // ─────────────────────────────
  // PRIVATE: scroll done guard
  // Prevents double scroll when spec calls scrollToPPVSection()
  // and clickBuyNow is called immediately after
  // ─────────────────────────────
  private _ppvScrollDone = false;

  // ─────────────────────────────
  // DISMISS CONSENT OVERLAY
  // ─────────────────────────────
  private async dismissConsentIfPresent(): Promise<void> {
    // Cookie banner is now dismissed via UI click in handleCookies()
    const { handleCookies } = await import('../utils/helpers.js');
    await handleCookies(this.page);
  }

  private isOnMyAccountPage(): boolean {
    const url = this.page.url().toLowerCase();
    return (
      url.includes('/myaccount') ||
      (url.includes('/account') &&
        !url.includes('/signup') &&
        !url.includes('/signin') &&
        !url.includes('/personaldetails') &&
        !url.includes('/emaildetails') &&
        !url.includes('/content/'))
    );
  }

  // ─────────────────────────────
  // SCROLL TO PPV SECTION
  // Called ONCE from spec — guard prevents double scroll
  // ─────────────────────────────
  async scrollToPPVSection(): Promise<void> {
    if (this._ppvScrollDone) {
      console.log('📺 PPV scroll already done — skipping');
      return;
    }

    // FIX: Only scroll on My Account page — not home page
    if (!this.isOnMyAccountPage()) {
      console.log(`⚠️  Not on My Account page (${this.page.url()}) — skipping scroll`);
      this._ppvScrollDone = true;
      return;
    }

    console.log('📺 Scrolling to Pay-Per-View section...');

    // Wait up to 5 seconds for the PPV heading to be attached to the DOM
    const headingLocator = this.page.locator('h1, h2, h3, h4, h5, span, div')
      .filter({ hasText: /pay-per-view|pay per view|available to buy/i })
      .first();
    await headingLocator.waitFor({ state: 'attached', timeout: 5000 }).catch(() => {
      console.log('⚠️ Timeout waiting for PPV section heading to attach to DOM');
    });

    const targetScrollY = await this.page.evaluate(() => {
      const allEls = Array.from(
        document.querySelectorAll('h1,h2,h3,h4,h5,span,div')
      );
      // Look for PPV section heading — strict match only
      // Do NOT include 'events' — too broad, matches home page
      const ppvHeadings = ['pay-per-view', 'pay per view', 'available to buy'];
      for (const el of allEls) {
        const text = (el as HTMLElement).innerText?.trim().toLowerCase() || '';
        if (ppvHeadings.some(h => text === h)) {
          const rect = el.getBoundingClientRect();
          const target = Math.max(0, window.scrollY + rect.top - 120);
          window.scrollTo({ top: target, behavior: 'instant' });
          return target;
        }
      }
      return -1;
    }).catch(() => -1);

    if (targetScrollY >= 0) {
      console.log(`✅ Scrolled to PPV section at ${targetScrollY}px`);

      // Lock scroll for 1.5s — prevents page snapping back
      await this.page.evaluate((lockedY: number) => {
        const interval = setInterval(() => {
          if (Math.abs(window.scrollY - lockedY) > 50) {
            window.scrollTo({ top: lockedY, behavior: 'instant' });
          }
        }, 50);
        setTimeout(() => clearInterval(interval), 800);
      }, targetScrollY);

      await this.page.waitForTimeout(800);

    } else {
      console.log('⚠️  PPV heading not found — scrolling to mid-page');
      await this.page.evaluate(() =>
        window.scrollTo({
          top: document.body.scrollHeight / 2,
          behavior: 'instant',
        })
      );
      await this.page.waitForTimeout(200);
    }

    const finalY = await this.page
      .evaluate(() => window.scrollY)
      .catch(() => -1);
    console.log(`📍 Final scroll position: ${finalY}px`);

    this._ppvScrollDone = true;
  }

  private async searchPPVInCurrentDOM(ppvName: string): Promise<Locator | null> {
    const regex = new RegExp(ppvName.split(/\s+/).join('.*'), 'i');

    const nameParts = ppvName
      .split(/[:\-–—,]+/)
      .flatMap(p => p.trim().split(/\s+/))
      .filter(w => w.length > 3 && !/^(the|and|for|with|from)$/i.test(w))
      .map(w => w.toLowerCase());
    const matchesPartially = (text: string): boolean => {
      const lower = text.toLowerCase();
      const matchCount = nameParts.filter(w => lower.includes(w)).length;
      return matchCount >= Math.min(2, nameParts.length);
    };

    // Candidates by full name regex
    const candidates = this.page.locator('div, li, article, section, a').filter({ hasText: regex });
    const count = await candidates.count().catch(() => 0);

    for (let i = 0; i < count; i++) {
      const el = candidates.nth(i);
      const text = await el.textContent().catch(() => '');
      if (!text || text.length > 400) continue;

      // Skip containers of multiple cards/events
      const ctas = el.locator('div[role="button"], button, a').filter({ hasText: /buy|get|book|continue|subscribe|purchase|select|choose/i });
      const ctaCount = await ctas.count().catch(() => 0);
      const subCardsCount = await el.locator('#addons-list-card, article, [class*="card" i]').count().catch(() => 0);
      if (ctaCount > 1 || subCardsCount > 1) {
        continue;
      }

      const tagName = await el.evaluate(node => node.tagName.toLowerCase()).catch(() => '');
      const role = await el.getAttribute('role').catch(() => null);
      const isSelfCTA = tagName === 'a' || tagName === 'button' || role === 'button';

      const hasCTA = isSelfCTA || ctaCount > 0;

      if (hasCTA) {
        return el;
      }

      const elText = text.toLowerCase();
      const hasPurchasedText = elText.includes('purchased') || elText.includes('included');
      if (hasPurchasedText && text.length < 200) {
        return el;
      }
    }

    // Try partial matching on cards
    const cardSelectors = [
      '#addons-list-card',
      'div[id*="ppv-card" i]',
      'div[class*="ppv-card" i]',
      'div[id*="ppv-tile" i]',
      'div[class*="ppv-tile" i]',
      'article',
      'div[class*="card" i]:not([class*="list" i]):not([class*="container" i]):not([class*="wrapper" i])',
      'div[id*="card" i]:not([id*="list" i]):not([id*="container" i]):not([id*="wrapper" i])',
      'div[class*="tile" i]',
      'div[class*="event" i]:not([class*="list" i]):not([class*="container" i]):not([class*="wrapper" i])',
      'a[href*="/ppv"]',
      'a[href*="/pay-per-view"]',
    ];
    const allCards = this.page.locator(cardSelectors.join(', '));
    const cardCount = await allCards.count().catch(() => 0);

    for (let i = 0; i < cardCount; i++) {
      const card = allCards.nth(i);
      const cardText = await card.textContent().catch(() => '');
      if (!cardText || cardText.length > 400) continue;

      if (matchesPartially(cardText)) {
        // Skip containers of multiple cards/events
        const ctas = card.locator('div[role="button"], button, a').filter({ hasText: /buy|get|book|continue|subscribe|purchase|select|choose/i });
        const ctaCount = await ctas.count().catch(() => 0);
        const subCardsCount = await card.locator('#addons-list-card, article, [class*="card" i]').count().catch(() => 0);
        if (ctaCount > 1 || subCardsCount > 1) {
          continue;
        }

        const tagName = await card.evaluate(node => node.tagName.toLowerCase()).catch(() => '');
        const role = await card.getAttribute('role').catch(() => null);
        const isSelfCTA = tagName === 'a' || tagName === 'button' || role === 'button';

        const hasCTA = isSelfCTA || ctaCount > 0;

        if (hasCTA) {
          return card;
        }

        const hasPurchased = cardText.toLowerCase().includes('purchased') || cardText.toLowerCase().includes('included');
        if (hasPurchased && cardText.length < 200) {
          return card;
        }
      }
    }

    return null;
  }

  // ─────────────────────────────
  // FIND PPV ROW BY EVENT NAME
  // ─────────────────────────────
  private async findPPVRow(ppvName: string): Promise<Locator | null> {
    console.log(`🔍 Searching for PPV: "${ppvName}"...`);

    // Wait for the My Account page sections/cards to load
    if (this.isOnMyAccountPage()) {
      console.log('⏳ Waiting for PPV section, cards, or Explore button to be attached to DOM...');
      const exploreSelector = 'a[href*="/ppv"], a[href*="/pay-per-view"], text=/explore.*ppv/i, text=/explore.*pay-per-view/i';
      const cardSelector = '[id*="ppv-card"], [class*="ppv-card"], article, [class*="card" i]';
      const headingSelector = 'h1, h2, h3, h4, h5, span, div';
      const combinedSelector = `${exploreSelector}, ${cardSelector}, ${headingSelector}`;

      await this.page.waitForSelector(combinedSelector, { state: 'attached', timeout: 8000 }).catch(() => {
        console.log('⚠️ Timeout waiting for PPV related elements to attach to DOM');
      });
      await this.page.waitForTimeout(1000);
    }

    // 1. Search in current DOM (My Account PPV section or Listing Page if already navigated)
    let row = await this.searchPPVInCurrentDOM(ppvName);
    if (row) {
      console.log(`✅ PPV row found in current view`);
      return row;
    }

    // 2. If not found, check if we are on My Account page
    if (this.isOnMyAccountPage()) {
      console.log(`ℹ️  PPV not found in My Account page — looking for "Explore more PPV events" link...`);

      let exploreBtn = this.page.getByText(/explore.*ppv/i).first();
      let isExploreVisible = await exploreBtn.isVisible({ timeout: 2000 }).catch(() => false);

      if (!isExploreVisible) {
        exploreBtn = this.page.getByText(/explore.*pay-per-view/i).first();
        isExploreVisible = await exploreBtn.isVisible({ timeout: 2000 }).catch(() => false);
      }

      if (!isExploreVisible) {
        exploreBtn = this.page.locator('a[href*="/ppv"], a[href*="/pay-per-view"]').first();
        isExploreVisible = await exploreBtn.isVisible({ timeout: 2000 }).catch(() => false);
      }

      if (isExploreVisible) {
        console.log(`🖱️  Clicking "Explore more PPV events" link...`);
        await exploreBtn.scrollIntoViewIfNeeded().catch(() => { });
        await exploreBtn.click({ force: true });

        // Wait for page load
        console.log(`⏳ Waiting for PPV listing page to load...`);
        await this.page.waitForLoadState('domcontentloaded').catch(() => { });
        console.log(`⏳ Waiting for PPV cards to render...`);
        await this.page.waitForSelector(
          '#addons-list-card, article, [class*="card" i], button:has-text("Buy now")',
          { state: 'visible', timeout: 10000 }
        ).catch(() => { });

        // 3. Search on the PPV listing page with auto-scroll
        console.log(`📜 Searching PPV on listing page with auto-scroll...`);
        let lastScrollY = -1;
        let currentScrollY = 0;

        while (currentScrollY !== lastScrollY) {
          row = await this.searchPPVInCurrentDOM(ppvName);
          if (row) {
            console.log(`✅ PPV row found on listing page!`);
            return row;
          }

          // Scroll down
          lastScrollY = currentScrollY;
          await this.page.evaluate(() => window.scrollBy(0, 600)).catch(() => { });
          await this.page.waitForTimeout(500);
          currentScrollY = await this.page.evaluate(() => window.scrollY).catch(() => 0);
        }
      }
    }

    // Debug dump on failure
    const sectionHtml = await this.page.evaluate(() => {
      const allEls = Array.from(document.querySelectorAll('h2, h3'));
      for (const el of allEls) {
        if (/pay-per-view/i.test((el as HTMLElement).innerText || '')) {
          return el.parentElement?.innerHTML?.substring(0, 2000) || 'N/A';
        }
      }
      return 'PPV section not found in DOM';
    }).catch(() => 'evaluate failed');
    console.log('🔍 PPV section HTML:\n', sectionHtml);

    // 4. PPV still not found -> Throw the critical error requested
    throw new Error(`PPV '${ppvName}' not found in My Account PPV section or Explore More PPV Events page.`);
  }

  // ─────────────────────────────
  // GET USER FULL NAME PARTS
  // Single DOM scan — anchors on email to avoid "My" from
  // "My Subscriptions" / "My Account"
  // Returns { firstName, lastName }
  // ─────────────────────────────
  async getUserName(): Promise<{ firstName: string; lastName: string }> {
    console.log('👤 Reading user name from My Account...');

    const EXCLUDE = [
      'my account', 'my subscriptions', 'my devices',
      'dazn free', 'dazn standard', 'dazn ultimate',
      'member since', 'back to dazn', 'need help',
      'overview', 'profile', 'manage', 'quick links',
      'pay-per-view', 'upgrade now', 'resubscribe',
      'view payment history',
      'explore other',
      'more on dazn',
      'redeem gift',
      'home location',
    ];

    const fullName = await this.page.evaluate((excludeList: string[]) => {
      const isNameLike = (text: string): boolean => {
        const lower = text.toLowerCase();
        return (
          text.length >= 2 &&
          text.length <= 50 &&
          !text.includes('@') &&
          !text.includes('£') &&
          !excludeList.some(ex => lower.includes(ex)) &&
          !/\d/.test(text) &&
          /^[A-Z][a-z]/.test(text) &&
          /^[A-Za-z\s\-']+$/.test(text)
        );
      };

      const allEls = Array.from(
        document.querySelectorAll<HTMLElement>('p, span, div, h2, h3')
      );

      // Step 1: Anchor on email — name is always near it
      let emailEl: HTMLElement | null = null;
      for (const el of allEls) {
        const text = el.innerText?.trim() || '';
        if (
          text.includes('@') &&
          text.includes('.') &&
          text.length < 60 &&
          !text.includes(' ')  // email has no spaces
        ) {
          emailEl = el;
          break;
        }
      }

      if (emailEl) {
        // Walk up 3 levels from email to find name sibling
        for (let depth = 0; depth < 3; depth++) {
          let container: HTMLElement | null = emailEl;
          for (let d = 0; d <= depth; d++) {
            container = container?.parentElement ?? null;
          }
          if (!container) continue;

          const siblings = Array.from(
            container.querySelectorAll<HTMLElement>('p, span, h2, h3')
          );

          for (const sib of siblings) {
            const text = sib.innerText?.trim() || '';
            // Full name = at least 2 words
            if (isNameLike(text) && text.split(/\s+/).length >= 2) {
              return text.trim();
            }
          }
        }
      }

      // Step 2: Full page scan with strict exclusions
      for (const el of allEls) {
        const text = el.innerText?.trim() || '';
        if (isNameLike(text) && text.split(/\s+/).length >= 2) {
          return text.trim();
        }
      }

      return '';
    }, EXCLUDE).catch(() => '');

    if (fullName) {
      const parts = fullName.trim().split(/\s+/);
      const firstName = parts[0] || '';
      const lastName = parts.slice(1).join(' ') || '';
      console.log(
        `✅ Full name: "${fullName}" → ` +
        `first="${firstName}" last="${lastName}"`
      );
      return { firstName, lastName };
    }

    console.log('⚠️  User name not found');
    return { firstName: '', lastName: '' };
  }

  // ─────────────────────────────
  // GET FIRST NAME (convenience wrapper)
  // ─────────────────────────────
  async getFirstName(): Promise<string> {
    const { firstName } = await this.getUserName();
    return firstName;
  }

  // ─────────────────────────────
  // GET LAST NAME (convenience wrapper)
  // ─────────────────────────────
  async getLastName(): Promise<string> {
    const { lastName } = await this.getUserName();
    return lastName;
  }

  // ─────────────────────────────
  // IS RETURNING USER
  // Returning = lapsed subscription, "Resubscribe" button visible
  // ─────────────────────────────
  async isReturningUser(): Promise<boolean> {
    const resubscribe = this.page
      .locator('button:has-text("Resubscribe")')
      .first();
    const isReturning = await resubscribe
      .isVisible({ timeout: 2000 })
      .catch(() => false);
    console.log(`🔄 Returning user: ${isReturning}`);
    return isReturning;
  }

  // ─────────────────────────────
  // VALIDATE MY ACCOUNT PAGE
  // ─────────────────────────────
  async getSubscriptionTier(): Promise<string> {
    const el = this.page
      .locator('text=/DAZN (Free|Standard|Ultimate|VIP)/i')
      .first();
    return (
      (await el.textContent({ timeout: 5000 }).catch(() => 'N/A'))?.trim() ||
      'N/A'
    );
  }

  async getSubscriptionStatus(): Promise<string> {
    // ── Resubscribe — returning/lapsed user ───────────────────
    const resubscribe = this.page
      .locator('button:has-text("Resubscribe")')
      .first();
    if (await resubscribe.isVisible({ timeout: 2000 }).catch(() => false)) {
      return 'Resubscribe';
    }

    // ── Upgrade now — freemium user ───────────────────────────
    const upgrade = this.page
      .locator('button:has-text("Upgrade now")')
      .first();
    if (await upgrade.isVisible({ timeout: 2000 }).catch(() => false)) {
      return 'Upgrade now';
    }

    // ── Manage subscription — active paid user (US/other regions)
    const manage = this.page
      .locator(
        'a:has-text("Manage subscription"), ' +
        'button:has-text("Manage subscription")'
      )
      .first();
    if (await manage.isVisible({ timeout: 2000 }).catch(() => false)) {
      return 'Manage subscription';
    }

    // ── Fallback — active user with no specific button ────────
    return 'Active';
  }
  async isPPVSectionPresent(): Promise<boolean> {
    const heading = this.page
      .locator('h2, h3')
      .filter({ hasText: /pay-per-view/i })
      .first();
    return await heading.isVisible({ timeout: 5000 }).catch(() => false);
  }

  // ─────────────────────────────
  // GET PPV DETAILS
  // ─────────────────────────────
  async getPPVName(ppvName: string): Promise<string> {
    const row = await this.findPPVRow(ppvName);
    if (!row) return 'N/A';
    const regex = new RegExp(ppvName.split(/\s+/).join('.*'), 'i');
    const el = row
      .locator('span, p, h2, h3, h4, strong')
      .filter({ hasText: regex })
      .first();
    return (await el.textContent().catch(() => 'N/A'))?.trim() || 'N/A';
  }

  async getPPVDate(ppvName: string): Promise<string> {
    const row = await this.findPPVRow(ppvName);
    if (!row) return 'N/A';
    const allEls = row.locator('span, p, div, time');
    const count = await allEls.count().catch(() => 0);
    for (let i = 0; i < count; i++) {
      const text =
        (await allEls.nth(i).textContent().catch(() => ''))?.trim() || '';
      if (
        /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b/i.test(text) &&
        /\d{1,2}(st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(
          text
        ) &&
        text.length < 60
      ) {
        return text;
      }
    }
    return 'N/A';
  }

  async getPPVPrice(ppvName: string): Promise<string> {
    const row = await this.findPPVRow(ppvName);
    if (!row) return 'N/A';
    const el = row
      .locator('span, p, div')
      .filter({ hasText: /[£$€]\s?[\d,.]+/ })
      .first();
    return (await el.textContent().catch(() => 'N/A'))?.trim() || 'N/A';
  }

  async getPPVStatus(ppvName: string): Promise<string> {
    const row = await this.findPPVRow(ppvName);
    if (!row) return 'N/A';

    // Check Buy Now — freemium / standard
    const buyNow = row
      .locator('div[role="button"], a, button')
      .filter({ hasText: /buy now/i })
      .first();
    if (await buyNow.isVisible({ timeout: 2000 }).catch(() => false)) {
      return 'Buy now';
    }

    // Check Purchased / Included — ultimate
    const purchased = row
      .locator(
        'text=/purchased/i, ' +
        'text=/included/i, ' +
        '[class*="purchased" i], ' +
        '[class*="included" i]'
      )
      .first();
    if (await purchased.isVisible({ timeout: 2000 }).catch(() => false)) {
      return (await purchased.textContent().catch(() => 'Purchased'))?.trim() || 'Purchased';
    }

    return 'N/A';
  }

  // ─────────────────────────────
  // IS PPV PURCHASED / INCLUDED
  // For ultimate tier — PPV shows "Purchased" or "Included"
  // No Buy Now button present
  // ─────────────────────────────
  async isPPVPurchased(ppvName: string): Promise<string> {
    console.log(`🔍 Checking PPV purchased status for: ${ppvName}`);

    // FIX: Use direct DOM query to find the specific PPV card
    // The PPV section has individual cards with id="purchased-ppv-card"
    // Each card has a name span and a status tag
    const result = await this.page.evaluate((name: string) => {
      // Find all PPV cards
      const cards = document.querySelectorAll('[id*="ppv-card"], [id*="ppv-list"] > div > div');
      for (const card of cards) {
        const cardText = (card as HTMLElement).innerText || '';
        // Check if this card contains the PPV name
        const nameParts = name.toLowerCase().split(/\s+/);
        const hasName = nameParts.every(part => cardText.toLowerCase().includes(part));
        if (!hasName) continue;

        // Check card length — individual card should be < 150 chars
        if (cardText.length > 300) continue;

        // Look for status
        if (/purchased/i.test(cardText)) return 'Purchased';
        if (/included/i.test(cardText)) return 'Included';
        if (/buy now/i.test(cardText)) return 'Buy now';
      }

      // Fallback: look for any element containing PPV name + Purchased
      const allEls = document.querySelectorAll('div, li, span');
      for (const el of allEls) {
        const text = (el as HTMLElement).innerText || '';
        if (text.length > 200 || text.length < 10) continue;
        const nameParts = name.toLowerCase().split(/\s+/);
        const hasName = nameParts.every(p => text.toLowerCase().includes(p));
        if (!hasName) continue;
        if (/purchased/i.test(text)) return 'Purchased';
        if (/included/i.test(text)) return 'Included';
        if (/buy now/i.test(text)) return 'Buy now';
      }
      return 'N/A';
    }, ppvName).catch(() => 'N/A');

    console.log(`✅ PPV Status: "${result}"`);
    return result;
  }

  // ─────────────────────────────
  // HANDLE SUBSCRIBE TO BUY MODAL
  // Appears after clicking Buy Now for freemium/resubscribe users
  // Must click "SEE DAZN PLANS" to proceed to PPV flow
  // ─────────────────────────────
  async handleSubscribeToBuyModal(): Promise<void> {
    console.log('🔍 Checking for "Subscribe to Buy" modal...');

    // Wait directly for the SEE DAZN PLANS button
    const seePlansBtn = this.page
      .locator('div[role="button"], button, a')
      .filter({ hasText: /see dazn plans/i })
      .first();

    const modalVisible = await seePlansBtn
      .isVisible({ timeout: 5000 })
      .catch(() => false);

    if (!modalVisible) {
      // Log all role=button divs for diagnosis
      const allRoleBtns = await this.page
        .locator('div[role="button"]')
        .allTextContents()
        .catch(() => []);
      console.log(
        '🔍 All div[role="button"]:',
        allRoleBtns.map(t => t.trim()).filter(Boolean)
      );
      console.log('ℹ️  No "Subscribe to Buy" modal — continuing');
      return;
    }

    console.log('✅ Modal detected — SEE DAZN PLANS button visible');

    // Click via mouse coordinates — most reliable for div[role="button"]
    const box = await seePlansBtn.boundingBox().catch(() => null);

    if (box && box.width > 0 && box.height > 0) {
      const cx = Math.round(box.x + box.width / 2);
      const cy = Math.round(box.y + box.height / 2);
      console.log(`🖱️  Clicking SEE DAZN PLANS at x=${cx} y=${cy}`);
      await this.page.mouse.move(cx, cy);
      await this.page.waitForTimeout(100);
      await this.page.mouse.click(cx, cy);
    } else {
      console.log('⚠️  No bounding box — using DOM click');
      await seePlansBtn.evaluate((el: HTMLElement) => el.click());
    }

    console.log('✅ Clicked SEE DAZN PLANS');

    // Wait for navigation away from myaccount / account
    await Promise.race([
      this.page.waitForURL(
        url => {
          const u = url.toString().toLowerCase();
          return !u.includes('myaccount') && !u.includes('/account');
        },
        { timeout: 10000 }
      ),
      this.page.waitForURL(
        url => url.toString().includes('signup'),
        { timeout: 10000 }
      ),
    ]).catch(() =>
      console.log('⚠️  URL unchanged after SEE DAZN PLANS click')
    );

    await this.page.waitForLoadState('domcontentloaded').catch(() => { });
    console.log(`✅ Post-modal URL: ${this.page.url()}`);
  }

  // ─────────────────────────────
  // CLICK BUY NOW
  // Does NOT call scrollToPPVSection — spec calls it once before
  // Full flow:
  //   1. Dismiss consent
  //   2. Find PPV row by event name
  //   3. Click div[role="button"] Buy Now
  //   4. Handle "Subscribe to Buy" modal if present
  //      (freemium/returning → SEE DAZN PLANS)
  //      (standard → no modal, direct navigation)
  // ─────────────────────────────
  async clickBuyNow(ppvName: string): Promise<void> {
    console.log(`💳 Clicking Buy Now for: ${ppvName}`);

    // Step 1: Dismiss consent
    await this.dismissConsentIfPresent();

    // Step 2: Find PPV row
    const row = await this.findPPVRow(ppvName);
    if (!row) {
      throw new Error(`❌ PPV row not found for: ${ppvName}`);
    }

    // Step 3: Locate Buy Now — div[role="button"] on this page
    const buyNowBtn = row
      .locator('div[role="button"], button, a')
      .filter({ hasText: /buy now/i })
      .first();

    await buyNowBtn.scrollIntoViewIfNeeded();
    await this.page.waitForTimeout(200);

    // Step 4: Dismiss consent — can reappear after scroll
    await this.dismissConsentIfPresent();
    await this.page.waitForTimeout(150);

    // Step 5: Validate interactable
    const box = await buyNowBtn.boundingBox();
    if (!box || box.width === 0 || box.height === 0) {
      throw new Error('❌ Buy Now not interactable — zero bounding box');
    }

    const cx = Math.round(box.x + box.width / 2);
    const cy = Math.round(box.y + box.height / 2);
    console.log(`🖱️  Buy Now at x=${cx} y=${cy}`);

    // Step 6: Mouse click — most reliable for div[role="button"]
    await this.page.mouse.move(cx, cy);
    await this.page.waitForTimeout(100);
    await this.page.mouse.click(cx, cy);

    console.log(`✅ Clicked Buy Now for: ${ppvName}`);

    // Step 7: Handle "Subscribe to Buy" modal
    // Freemium/returning → modal appears → click SEE DAZN PLANS
    // Standard           → no modal → direct navigation
    await this.handleSubscribeToBuyModal();
  }
}