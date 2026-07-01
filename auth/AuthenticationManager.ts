import { Page, BrowserContext } from '@playwright/test';
import { handleCookies, dismissMarketingPopup, stabilisePage } from '../utils/helpers';
import { clickAndWaitForNav } from '../utils/testHelpers';

/**
 * AuthMethod — supported authentication providers.
 */
export enum AuthMethod {
  Email = 'email',
  Google = 'google',
  Apple = 'apple',
  Facebook = 'facebook',
  FIFA = 'fifa',
}

/** Parse AUTH_METHOD or SOCIAL_LOGIN env variable into a typed AuthMethod value. Defaults to Email. */
export function resolveAuthMethod(): AuthMethod {
  const raw = (process.env.AUTH_METHOD || process.env.SOCIAL_LOGIN || 'email').toLowerCase().trim();
  const found = Object.values(AuthMethod).find(v => v === raw);
  if (!found) {
    console.warn(`⚠️  [Auth] Unknown authentication method "${raw}" — falling back to email`);
    return AuthMethod.Email;
  }
  return found as AuthMethod;
}

/**
 * Credentials resolved for the current authentication session.
 */
export interface LoginCredentials {
  email: string;
  password: string;
}

/**
 * Contract every login strategy must implement.
 */
export interface LoginStrategy {
  login(page: Page, context: BrowserContext, credentials: LoginCredentials): Promise<void>;
  verifyAuthenticatedSession(page: Page): Promise<boolean>;
}

/**
 * CredentialResolver — resolves login credentials based on AUTH_METHOD.
 */
export class CredentialResolver {
  static getCredentials(
    method: AuthMethod,
    eventDataOverride?: Record<string, string>
  ): LoginCredentials {
    switch (method) {
      case AuthMethod.Google:
        return CredentialResolver.fromEnv('GOOGLE_EMAIL', 'GOOGLE_PASSWORD', 'Google');

      case AuthMethod.Apple:
        return CredentialResolver.fromEnv('APPLE_EMAIL', 'APPLE_PASSWORD', 'Apple');

      case AuthMethod.Facebook:
        return CredentialResolver.fromEnv('FACEBOOK_EMAIL', 'FACEBOOK_PASSWORD', 'Facebook');

      case AuthMethod.FIFA:
        return CredentialResolver.fromEnv('FIFA_EMAIL', 'FIFA_PASSWORD', 'FIFA');

      case AuthMethod.Email:
      default: {
        const email =
          eventDataOverride?.USER_EMAIL ||
          process.env.USER_EMAIL ||
          process.env.DAZN_EMAIL ||
          '';
        const password =
          eventDataOverride?.USER_PASSWORD ||
          process.env.USER_PASSWORD ||
          process.env.DAZN_PASSWORD ||
          '';

        if (!email) {
          console.warn('⚠️  [CredentialResolver] No email found for EMAIL strategy');
        }
        return { email, password };
      }
    }
  }

  private static fromEnv(
    emailKey: string,
    passwordKey: string,
    providerName: string
  ): LoginCredentials {
    const email = process.env[emailKey] || '';
    const password = process.env[passwordKey] || '';

    if (!email || !password) {
      throw new Error(
        `❌ [CredentialResolver] Missing credentials for ${providerName} strategy.\n` +
        `   Set ${emailKey} and ${passwordKey} in your .env file.`
      );
    }

    return { email, password };
  }
}

/**
 * BaseLoginStrategy — shared utilities for all login strategies.
 */
export abstract class BaseLoginStrategy implements LoginStrategy {
  abstract login(page: Page, context: BrowserContext, credentials: LoginCredentials): Promise<void>;

  async verifyAuthenticatedSession(page: Page): Promise<boolean> {
    if (page.isClosed()) return false;

    const authSelectors = [
      '[data-test-id*="user-menu" i]',
      '[data-test-id*="profile" i]',
      '[data-test-id*="avatar" i]',
      '[aria-label*="account" i]',
      '[aria-label*="profile" i]',
      '[aria-label*="user menu" i]',
      '[class*="user-menu" i]',
      '[class*="avatar" i]',
      '[class*="profile-icon" i]',
      '[class*="account-menu" i]',
    ];

    for (const selector of authSelectors) {
      try {
        const el = page.locator(selector).first();
        const visible = await el.isVisible({ timeout: 2000 }).catch(() => false);
        if (visible) {
          console.log(`✅ [Auth] Login verified via selector: ${selector}`);
          return true;
        }
      } catch { /* continue */ }
    }

    const url = page.url().toLowerCase();
    const isAuthPage = url.includes('/signin') || url.includes('/signup') || url.includes('/content/');
    const isDaznPage = url.includes('dazn.com');
    if (isDaznPage && !isAuthPage) {
      const subscribeGone = await page
        .locator('button:has-text("Subscribe"), a:has-text("Subscribe")')
        .first()
        .isVisible({ timeout: 1000 })
        .catch(() => false);

      const navVisible = await page
        .locator('nav a, header a, [class*="nav" i] a')
        .first()
        .isVisible({ timeout: 1000 })
        .catch(() => false);

      if (navVisible && !subscribeGone) {
        console.log('✅ [Auth] Login verified via page context (no signin redirect, nav visible)');
        return true;
      }
    }

    console.warn('⚠️  [Auth] Could not verify login — no auth signal found');
    return false;
  }

  async dismissPostLoginPopups(page: Page): Promise<void> {
    if (page.isClosed()) return;

    try {
      await handleCookies(page, 5000).catch(() => { });
      await dismissMarketingPopup(page, 5000).catch(() => { });

      const welcomeSelectors = [
        'button:has-text("Got it")',
        'button:has-text("Let\'s go")',
        'button:has-text("Start watching")',
        'button:has-text("Continue")',
        '[data-test-id*="dismiss" i]',
        '[data-test-id*="close" i]',
        '[aria-label*="close" i]',
      ].join(', ');

      const welcomeBtn = page.locator(welcomeSelectors).first();
      if (await welcomeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
        const btnText = await welcomeBtn.textContent().catch(() => '');
        console.log(`🔔 [Auth] Dismissing post-login popup: "${btnText?.trim()}"`);
        await welcomeBtn.click({ force: true }).catch(() => { });
      }
    } catch (e) {
      console.warn('⚠️  [Auth] Error in dismissPostLoginPopups:', e);
    }
  }

  protected async handleCookieBanner(page: Page, timeout = 15000): Promise<void> {
    await handleCookies(page, timeout).catch(() => { });
  }
}

/**
 * EmailLoginStrategy — standard DAZN email + password login flow.
 */
export class EmailLoginStrategy extends BaseLoginStrategy {
  private baseUrl: string;

  constructor(baseUrl: string) {
    super();
    this.baseUrl = baseUrl;
  }

  async login(page: Page, _context: BrowserContext, credentials: LoginCredentials): Promise<void> {
    const { email, password } = credentials;

    if (!email) throw new Error('❌ [EmailLoginStrategy] No email provided');
    if (!password) throw new Error('❌ [EmailLoginStrategy] No password provided');

    const currentUrl = page.url().toLowerCase();
    const isOnAuthPage = currentUrl.includes('/signin') || currentUrl.includes('/signup') || currentUrl.includes('emaildetails') || currentUrl.includes('checkout');
    if (!isOnAuthPage) {
      const signinUrl = `${this.baseUrl}/signin`;
      console.log(`\n🔐 [Email Auth] Navigating to: ${signinUrl}`);
      await page.goto(signinUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
    } else {
      console.log(`📍 [Email Auth] Already on authentication page: ${page.url()}`);
    }

    await this.handleCookieBanner(page, 15000);
    const cookieOverlay = page.locator('#onetrust-consent-sdk, .onetrust-pc-dark-filter');
    await cookieOverlay.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await stabilisePage(page);

    await page.waitForURL(/emailDetails|signup|signin/i, { timeout: 10000 }).catch(() => { });
    await page.waitForLoadState('domcontentloaded').catch(() => { });
    console.log(`📍 [Email Auth] Landed on: ${page.url()}`);

    const emailInput = page.locator(
      'input[type="email"], input[name="email"], input[placeholder*="email" i]'
    ).first();
    const passwordInput = page.locator(
      'input[type="password"], input[name="password"]'
    ).first();

    await Promise.any([
      emailInput.waitFor({ state: 'visible', timeout: 10000 }),
      passwordInput.waitFor({ state: 'visible', timeout: 10000 }),
    ]).catch(() => { });

    const emailVisible = await emailInput.isVisible({ timeout: 500 }).catch(() => false);

    if (emailVisible) {
      console.log(`📧 [Email Auth] Entering email: ${email}`);
      await emailInput.fill(email);

      const nextBtn = page.locator(
        'button:has-text("Next"), button:has-text("Continue"), button[type="submit"]'
      ).first();
      await clickAndWaitForNav(page, nextBtn, 'Email → Next');
      await passwordInput.waitFor({ state: 'visible', timeout: 15000 }).catch(() => { });
    }

    const pwdNowVisible = await passwordInput.isVisible({ timeout: 1000 }).catch(() => false);
    if (pwdNowVisible) {
      console.log('🔑 [Email Auth] Entering password...');
      await passwordInput.fill(password);

      const signInBtn = page.locator(
        'button:has-text("Sign in"), button:has-text("Log in"), button:has-text("Sign In"), button[type="submit"]'
      ).first();
      await clickAndWaitForNav(page, signInBtn, 'Sign In');
    } else {
      throw new Error('❌ [EmailLoginStrategy] Password input never appeared');
    }

    await page.waitForURL(
      (url: URL) => !url.href.includes('/signin') && !url.href.includes('/signup'),
      { timeout: 20000 }
    ).catch(() => { });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
    console.log(`✅ [Email Auth] Signed in — on: ${page.url()}`);

    await this.dismissPostLoginPopups(page);
    await stabilisePage(page);

    const verified = await this.verifyAuthenticatedSession(page);
    if (!verified) {
      console.warn('⚠️  [Email Auth] Could not confirm login success — continuing anyway');
    }
  }
}

/**
 * GoogleLoginStrategy — DAZN Google OAuth login flow.
 */
export class GoogleLoginStrategy extends BaseLoginStrategy {
  private baseUrl: string;

  constructor(baseUrl: string) {
    super();
    this.baseUrl = baseUrl;
  }

  async login(page: Page, context: BrowserContext, credentials: LoginCredentials): Promise<void> {
    const { email, password } = credentials;

    if (!email) throw new Error('❌ [GoogleLoginStrategy] No Google email provided');
    if (!password) throw new Error('❌ [GoogleLoginStrategy] No Google password provided');

    const currentUrl = page.url().toLowerCase();
    const isOnAuthPage = currentUrl.includes('/signin') || currentUrl.includes('/signup') || currentUrl.includes('emaildetails') || currentUrl.includes('checkout');
    if (!isOnAuthPage) {
      const signinUrl = `${this.baseUrl}/signin`;
      console.log(`\n🔐 [Google Auth] Navigating to: ${signinUrl}`);
      await page.goto(signinUrl, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
    }
    await this.handleCookieBanner(page, 15000);
    
    // Wait for cookie banner overlay to fully disappear
    const cookieOverlay = page.locator('#onetrust-consent-sdk, .onetrust-pc-dark-filter');
    await cookieOverlay.waitFor({ state: 'hidden', timeout: 10000 }).catch(() => {});
    await stabilisePage(page);

    // ── Step 2: Click "Continue with Google" ─────────────────────────
    const googleBtn = page.locator(
      'button:has-text("Continue with Google"), ' +
      'a:has-text("Continue with Google"), ' +
      '[data-test-id*="google" i], ' +
      '[aria-label*="google" i], ' +
      '[class*="google" i] button'
    ).first();

    await googleBtn.waitFor({ state: 'visible', timeout: 10000 });
    console.log('🟢 [Google Auth] Clicking "Continue with Google"...');

    // ── Step 3: Wait for Google popup/tab to open (with retry for hydration) ──
    let googlePage!: Page;
    const maxRetries = 3;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`⏳ [Google Auth] Attempting click on Google button (Attempt ${attempt}/${maxRetries})...`);
        const googlePagePromise = context.waitForEvent('page', { timeout: 10000 });
        
        await googleBtn.click().catch(() => googleBtn.click({ force: true }));
        
        googlePage = await googlePagePromise;
        console.log('🔓 [Google Auth] Google tab opened');
        break;
      } catch (e: any) {
        console.warn(`⚠️ [Google Auth] Popup did not open on attempt ${attempt}. Error: ${e.message}`);
        if (attempt === maxRetries) {
          throw new Error(
            '❌ [GoogleLoginStrategy] Google OAuth tab did not open after multiple attempts.\n' +
            '   Check if the DAZN page blocked the popup or the selector is wrong.'
          );
        }
        await page.waitForTimeout(3000);
      }
    }

    await googlePage.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => { });
    await googlePage.bringToFront();

    // ── Step 4: Handle Google auth page ──────────────────────────────
    await this.handleGoogleAuthPage(googlePage, email, password);

    // ── Step 5: Wait for Google tab to close (or redirect) ───────────
    await this.waitForGoogleTabClose(googlePage);

    // ── Step 6: Switch back to DAZN page and wait for auth ───────────
    console.log('↩️  [Google Auth] Switching back to DAZN page...');
    await page.bringToFront();

    await page.waitForURL(
      (url: URL) =>
        !url.href.includes('/signin') &&
        !url.href.includes('/signup') &&
        url.href.includes('dazn.com'),
      { timeout: 30000 }
    ).catch(() => { });
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => { });
    console.log(`✅ [Google Auth] Back on DAZN: ${page.url()}`);

    // ── Step 7: Dismiss post-login popups ───────────────────────────
    await this.dismissPostLoginPopups(page);
    await stabilisePage(page);

    // ── Step 8: Verify authenticated session ────────────────────────
    const verified = await this.verifyAuthenticatedSession(page);
    if (!verified) {
      console.warn('⚠️  [Google Auth] Could not confirm login success — continuing anyway');
    } else {
      console.log('✅ [Google Auth] Login verified');
    }
  }

  private async handleGoogleAuthPage(
    googlePage: Page,
    email: string,
    password: string
  ): Promise<void> {
    await googlePage.waitForLoadState('domcontentloaded', { timeout: 10000 }).catch(() => { });

    const bodyText = await googlePage.locator('body').innerText({ timeout: 3000 }).catch(() => '');
    if (
      /captcha|verify it.*you|unusual traffic|automated|robot/i.test(bodyText)
    ) {
      throw new Error(
        '❌ [GoogleLoginStrategy] Google detected automated traffic (CAPTCHA shown).\n' +
        '   Manual intervention required. Run headed and complete the CAPTCHA once to prime the session.'
      );
    }

    const accountPickerVisible = await googlePage
      .locator('[data-email], [data-identifier], li[jsname]')
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false);

    if (accountPickerVisible) {
      console.log('👤 [Google Auth] Account picker shown — selecting account...');
      await this.handleAccountPicker(googlePage, email, password);
      return;
    }

    const emailInput = googlePage.locator(
      'input[type="email"], input[name="identifier"], input[autocomplete*="email" i]'
    ).first();

    const emailVisible = await emailInput.isVisible({ timeout: 5000 }).catch(() => false);

    if (emailVisible) {
      console.log(`📧 [Google Auth] Entering email: ${email}`);
      await emailInput.click();
      await emailInput.fill(email);

      const nextBtn = googlePage.locator(
        '#identifierNext button, button:has-text("Next"), input[type="submit"]'
      ).first();
      await nextBtn.waitFor({ state: 'visible', timeout: 5000 });
      await nextBtn.click({ force: true });
      console.log('⏭️  [Google Auth] Clicked Next after email');
    }

    await this.enterPassword(googlePage, password);
    await this.handleConsentScreen(googlePage);
  }

  private async handleAccountPicker(
    googlePage: Page,
    email: string,
    password: string
  ): Promise<void> {
    const accountByEmail = googlePage.locator(
      `[data-email="${email}"], [data-identifier="${email}"], li:has-text("${email}")`
    ).first();

    const accountVisible = await accountByEmail.isVisible({ timeout: 3000 }).catch(() => false);

    if (accountVisible) {
      console.log(`👤 [Google Auth] Selecting account: ${email}`);
      await accountByEmail.click({ force: true });
    } else {
      const firstAccount = googlePage.locator('li[jsname], [data-authuser]').first();
      if (await firstAccount.isVisible({ timeout: 2000 }).catch(() => false)) {
        console.log('👤 [Google Auth] Selecting first available account');
        await firstAccount.click({ force: true });
      }
    }

    await googlePage.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => { });

    const pwdInput = googlePage.locator('input[type="password"]').first();
    if (await pwdInput.isVisible({ timeout: 5000 }).catch(() => false)) {
      await this.enterPassword(googlePage, password);
    } else {
      console.log('ℹ️  [Google Auth] No password required after account picker (pre-auth session)');
    }

    await this.handleConsentScreen(googlePage);
  }

  private async enterPassword(googlePage: Page, password: string): Promise<void> {
    const pwdInput = googlePage.locator('input[type="password"]').first();

    try {
      await pwdInput.waitFor({ state: 'visible', timeout: 15000 });
    } catch {
      console.log('ℹ️  [Google Auth] Password field did not appear — may be pre-authenticated');
      return;
    }

    const bodyText = await googlePage.locator('body').innerText({ timeout: 2000 }).catch(() => '');
    if (/captcha|verify it.*you|unusual traffic/i.test(bodyText)) {
      throw new Error('❌ [GoogleLoginStrategy] CAPTCHA appeared after email entry.');
    }

    console.log('🔑 [Google Auth] Entering password...');
    await pwdInput.click();
    await pwdInput.fill(password);

    const pwdNextBtn = googlePage.locator(
      '#passwordNext button, button:has-text("Next"), input[type="submit"]'
    ).first();
    await pwdNextBtn.waitFor({ state: 'visible', timeout: 5000 });
    await pwdNextBtn.click({ force: true });
    console.log('⏭️  [Google Auth] Clicked Next after password');
  }

  private async handleConsentScreen(googlePage: Page): Promise<void> {
    if (googlePage.isClosed()) return;

    await googlePage.waitForLoadState('domcontentloaded', { timeout: 8000 }).catch(() => { });

    const continueBtn = googlePage.locator(
      'button:has-text("Continue"), button:has-text("Allow"), [data-action="confirm"]'
    ).first();

    const consentVisible = await continueBtn.isVisible({ timeout: 5000 }).catch(() => false);

    if (consentVisible) {
      console.log('✅ [Google Auth] Consent screen shown — clicking Continue...');
      await continueBtn.click({ force: true });
      console.log('✅ [Google Auth] Consent granted');
    } else {
      console.log('ℹ️  [Google Auth] No consent screen — proceeding');
    }
  }

  private async waitForGoogleTabClose(googlePage: Page): Promise<void> {
    if (googlePage.isClosed()) {
      console.log('✅ [Google Auth] Google tab already closed');
      return;
    }

    console.log('⏳ [Google Auth] Waiting for Google tab to close...');
    try {
      await googlePage.waitForEvent('close', { timeout: 30000 });
      console.log('✅ [Google Auth] Google tab closed');
    } catch {
      console.warn('⚠️  [Google Auth] Google tab did not auto-close — it may have redirected');
      const url = googlePage.isClosed() ? '' : googlePage.url();
      if (url.includes('google.com') || url.includes('accounts.google')) {
        await googlePage.close().catch(() => { });
      }
    }
  }
}

/**
 * AuthenticationManager — single entry point for all authentication flows.
 */
export class AuthenticationManager {
  private page: Page;
  private context: BrowserContext;
  private baseUrl: string;
  private method: AuthMethod;

  constructor(page: Page, context: BrowserContext, baseUrl: string) {
    this.page = page;
    this.context = context;
    this.baseUrl = baseUrl;
    this.method = resolveAuthMethod();
    console.log(`🔐 [AuthManager] Method: ${this.method.toUpperCase()}`);
  }

  async authenticate(eventData?: Record<string, string>): Promise<void> {
    const strategy = this.createStrategy(this.method);
    const credentials = CredentialResolver.getCredentials(this.method, eventData);

    console.log(`🔐 [AuthManager] Authenticating via: ${this.method}`);
    await strategy.login(this.page, this.context, credentials);
  }

  async verifySession(): Promise<boolean> {
    const strategy = this.createStrategy(this.method);
    return strategy.verifyAuthenticatedSession(this.page);
  }

  getMethod(): AuthMethod {
    return this.method;
  }

  private createStrategy(method: AuthMethod): LoginStrategy {
    switch (method) {
      case AuthMethod.Google:
        return new GoogleLoginStrategy(this.baseUrl);

      case AuthMethod.Apple:
        throw new Error('❌ [AuthManager] Apple login strategy is not yet implemented.');

      case AuthMethod.Facebook:
        throw new Error('❌ [AuthManager] Facebook login strategy is not yet implemented.');

      case AuthMethod.FIFA:
        throw new Error('❌ [AuthManager] FIFA login strategy is not yet implemented.');

      case AuthMethod.Email:
      default:
        return new EmailLoginStrategy(this.baseUrl);
    }
  }
}
