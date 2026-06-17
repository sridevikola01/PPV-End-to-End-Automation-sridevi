import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir:   './tests',
  timeout:   300_000,
  retries:   0,
  workers:   process.env.CI ? 4 : 1,
  outputDir: 'test-results',

  use: {
    headless:  process.env.HEADLESS === 'true',
    viewport:  null,
    timezoneId: 'Asia/Kolkata',
    locale:    'en-IN',

    launchOptions: {
      args: [
        '--start-maximized',
        '--disable-infobars',
        '--no-sandbox',
        '--disable-dev-shm-usage',
        '--password-store=basic',
        '--use-mock-keychain',
        '--disable-popup-blocking',
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
        timezoneId: 'Asia/Kolkata',
        locale:    'en-IN',

        launchOptions: {
          args: [
            '--start-maximized',
            '--disable-infobars',
            '--no-sandbox',
            '--disable-dev-shm-usage',
            '--disable-blink-features=AutomationControlled',
            '--password-store=basic',
            '--use-mock-keychain',
            '--disable-popup-blocking',
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