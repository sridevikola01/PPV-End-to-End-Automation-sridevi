import { defineConfig } from '@playwright/test';

// Map DAZN region to browser timezone + locale so event times match the region
const regionTimezoneMap: Record<string, { timezoneId: string; locale: string }> = {
  GB:  { timezoneId: 'Europe/London',       locale: 'en-GB' },
  IE:  { timezoneId: 'Europe/Dublin',       locale: 'en-IE' },
  DE:  { timezoneId: 'Europe/Berlin',       locale: 'de-DE' },
  IT:  { timezoneId: 'Europe/Rome',         locale: 'it-IT' },
  ES:  { timezoneId: 'Europe/Madrid',       locale: 'es-ES' },
  AT:  { timezoneId: 'Europe/Vienna',       locale: 'de-AT' },
  CH:  { timezoneId: 'Europe/Zurich',       locale: 'de-CH' },
  CA:  { timezoneId: 'America/Toronto',     locale: 'en-CA' },
  US:  { timezoneId: 'America/New_York',    locale: 'en-US' },
  AU:  { timezoneId: 'Australia/Sydney',    locale: 'en-AU' },
  JP:  { timezoneId: 'Asia/Tokyo',          locale: 'ja-JP' },
  BR:  { timezoneId: 'America/Sao_Paulo',   locale: 'pt-BR' },
};

const region = (process.env.DAZN_REGION || 'GB').toUpperCase();
const { timezoneId, locale } = regionTimezoneMap[region] || regionTimezoneMap['GB'];

export default defineConfig({
  testDir:   './tests',
  timeout:   300_000,
  retries:   0,
  workers:   process.env.CI ? 4 : 1,
  outputDir: 'test-results',

  use: {
    headless:  process.env.HEADLESS === 'true',
    viewport:  null,
    timezoneId,
    locale,

    launchOptions: {
      args: [
        '--start-maximized',
        '--disable-infobars',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--password-store=basic',
        '--use-mock-keychain',
      ],
    },

    actionTimeout:     15_000,
    navigationTimeout: 30_000,

    video: {
      mode: process.env.CI ? 'on' : 'retain-on-failure',
      size: { width: 1920, height: 1080 },
    },

    screenshot: 'only-on-failure',
    trace:      'retain-on-failure',
  },

  projects: [
    // ── Desktop Chrome ───────────────────────────────────────────────────────
    {
      name: 'chromium',
      use: {
        channel:  'chrome',
        headless: process.env.HEADLESS === 'true',
        viewport: null,
        launchOptions: {
          args: [
            '--start-maximized',
            '--disable-infobars',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--password-store=basic',
            '--use-mock-keychain',
          ],
        },
      },
    },

    // ── Mobile: Android Chrome (Pixel 7) ─────────────────────────────────────
    // Used for the mobile handoff flow:
    //   Appium navigates app → user reaches paywall → copies URL → Chrome opens it
    //   Playwright opens the same URL in Android Chrome emulation for validation.
    {
      name: 'mobile-android',
      testMatch: '**/mobile/**/*.spec.ts',
      use: {
        ...require('@playwright/test').devices['Pixel 7'],
        channel: 'chrome',
        headless: process.env.HEADLESS === 'true',
        launchOptions: {
          args: [
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
          ],
        },
      },
    },

    // ── Mobile: iOS Safari (iPhone 14) ────────────────────────────────────────
    // Used for the mobile handoff flow:
    //   Appium navigates app → user accepts Apple consent → Safari opens checkout URL
    //   Playwright opens the same URL in iPhone Safari emulation for validation.
    {
      name: 'mobile-ios',
      testMatch: '**/mobile/**/*.spec.ts',
      use: {
        ...require('@playwright/test').devices['iPhone 14'],
        headless: process.env.HEADLESS === 'true',
      },
    },
  ],

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'always' }],
  ],
});