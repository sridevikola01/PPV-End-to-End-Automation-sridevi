// ─────────────────────────────────────────────────────────────────────────────
// DAZN PPV — WebdriverIO config for ANDROID (UiAutomator2)
//
// TARGET DEVICE: Samsung Galaxy Z Fold5 (real device via USB / ADB)
//
// FLOW:
//   1. Connects to real device (ADB must be authorised — run: adb devices)
//   2. Launches DAZN app (already installed & logged in)
//   3. Android test:
//        - Dismisses system dialogs / update prompts
//        - Finds PPV banner ("Joshua vs. Prenga") on Home screen
//        - Taps banner → in-app PPV landing page
//        - Taps "Buy" → app opens Chrome with the checkout URL
//        - Captures URL via WebView context switch or ADB
//        - Writes URL to mobile_entry_url.txt
//   4. run_mobile_test.sh reads the URL → Playwright validates checkout
//
// PRE-REQUISITES:
//   - Device connected via USB with ADB authorised
//     Run: adb devices  → should show your device serial
//   - DAZN app installed and user already logged in (noReset: true)
//   - Appium 3.x installed globally (appium --version)
//   - chromedriver will be auto-downloaded by Appium for the device Chrome version
//
// HOW TO RUN:
//   cd appium
//   npm run android
//
// ENV VARS (all optional — defaults match Galaxy Z Fold5):
//   DEVICE_NAME      : ADB device name / serial  (default: Galaxy Z Fold5)
//   PLATFORM_VERSION : Android OS version        (default: 16.0)
//   APP_PACKAGE      : DAZN app package          (default: com.dazn)
//   APP_ACTIVITY     : Launch activity           (default: com.dazn.splash.view.SplashScreenActivity)
//   PPV_NAME         : Event name to search for  (default: Joshua)
// ─────────────────────────────────────────────────────────────────────────────


const ANDROID_SDK = process.env.ANDROID_HOME || `${process.env.HOME}/Library/Android/sdk`;
const ADB         = `${ANDROID_SDK}/platform-tools/adb`;

// Export ANDROID_HOME at module level so Appium server inherits it
process.env.ANDROID_HOME = ANDROID_SDK;
process.env.ANDROID_SDK_ROOT = ANDROID_SDK;
process.env.ADB_PATH = ADB;

export const config = {
  runner: 'local',
  port:   4723,
  path:   '/',

  services: [
    [
      '@wdio/appium-service',
      {
        command: 'appium',
        args: {
          address:         '127.0.0.1',
          port:            4723,
          relaxedSecurity: true,
        },
      },
    ],
  ],

  specs:        ['../tests/android/*.spec.ts'],
  exclude:      [],
  maxInstances: 1,

  capabilities: [
    {
      platformName:                      'Android',
      'appium:deviceName':               process.env.DEVICE_NAME       || 'Galaxy Z Fold5',
      'appium:platformVersion':          process.env.PLATFORM_VERSION   || '16',
      'appium:automationName':           'UiAutomator2',
      'appium:appPackage':               process.env.APP_PACKAGE        || 'com.dazn',
      'appium:appActivity':              process.env.APP_ACTIVITY       || 'com.dazn.splash.view.SplashScreenActivity',
      'appium:noReset':                  true,
      'appium:forceAppLaunch':           true,
      'appium:autoGrantPermissions':     true,
      'appium:unicodeKeyboard':          true,
      'appium:resetKeyboard':            true,
      'appium:chromeOptions':            { androidPackage: 'com.android.chrome' },
      'appium:chromedriverAutodownload': true,
      'appium:newCommandTimeout':        300,
      'appium:uiautomator2ServerInstallTimeout': 60000,
    } as any,
  ],

  logLevel:               'info',
  bail:                   0,
  waitforTimeout:         20000,
  connectionRetryTimeout: 180000,
  connectionRetryCount:   3,

  framework: 'mocha',
  reporters: ['spec'],
  mochaOpts: {
    ui:      'bdd',
    timeout: 300000,
  },

  before() {
    process.env.ANDROID_HOME = ANDROID_SDK;
    process.env.ADB_PATH     = ADB;
  },
};