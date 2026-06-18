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
        '--disable-blink-features=AutomationControlled',
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
  ],

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'always' }],
  ],
});