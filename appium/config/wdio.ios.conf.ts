// ─────────────────────────────────────────────────────────────────────────────
// DAZN PPV — WebdriverIO config for iOS (XCUITest)
//
// What this does:
//   1. Boots iPhone 16 Pro simulator
//   2. Launches the DAZN app
//   3. Runs the iOS PPV test which:
//        - Navigates to Home screen
//        - Finds and taps the PPV banner
//        - Taps "Buy" → Apple consent sheet appears
//        - Accepts redirect to Safari
//        - Captures the web checkout URL from Safari
//        - Writes it to mobile_entry_url.txt
//   4. Playwright reads the URL and runs web validation
//
// PRE-REQUISITES:
//   - iPhone 16 Pro simulator present (already confirmed)
//   - DAZN app installed on simulator OR ipa path via DAZN_IPA_PATH
//   - DAZN_BUNDLE_ID set if different from default
// ─────────────────────────────────────────────────────────────────────────────
import type { Options } from '@wdio/types';

const BUNDLE_ID = process.env.DAZN_BUNDLE_ID || 'com.dazn.enterprise';
const IPA_PATH  = process.env.DAZN_IPA_PATH  || '';

// iPhone 16 Pro UDID (from xcrun simctl list)
const SIMULATOR_UDID = process.env.IOS_UDID || '2BA2D104-D63D-4E22-8E15-7E1FA9B9E26C';

export const config = {
  runner: 'local',
  port: 4723,
  path: '/',
  services: [
    [
      '@wdio/appium-service',
      {
        command: 'appium',
        args: {
          address: '127.0.0.1',
          port: 4723,
          relaxedSecurity: true,
        },
      },
    ],
  ],

  specs: ['./tests/ios/*.spec.ts'],
  exclude: [],
  maxInstances: 1,

  capabilities: [
    {
      platformName: 'iOS',
      'appium:deviceName': 'iPhone 16 Pro',
      'appium:platformVersion': '18',
      'appium:automationName': 'XCUITest',
      'appium:udid': SIMULATOR_UDID,
      'appium:bundleId': BUNDLE_ID,
      ...(IPA_PATH ? { 'appium:app': IPA_PATH } : {}),
      'appium:noReset': true,
      'appium:fullReset': false,
      'appium:newCommandTimeout': 120,
      'appium:wdaLaunchTimeout': 60000,
      'appium:wdaConnectionTimeout': 60000,
      'appium:simulatorStartupTimeout': 120000,
      'appium:autoAcceptAlerts': false,       // we handle alerts manually (Safari redirect)
      'appium:autoDismissAlerts': false,
    },
  ],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 15000,
  connectionRetryTimeout: 180000,
  connectionRetryCount: 3,

  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui: 'bdd',
    timeout: 300000,
  },
};
