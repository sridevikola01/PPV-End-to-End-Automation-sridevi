// ─────────────────────────────────────────────────────────────────────────────
// DAZN PPV — WebdriverIO config for ANDROID (UiAutomator2)
//
// Works with ANY connected Android device — deviceName and platformVersion
// are auto-detected via ADB at runtime (no hardcoding needed).
//
// FLOW:
//   1. Connects to first ADB-authorised device (or DEVICE_SERIAL env var)
//   2. Launches DAZN app (already installed & logged in)
//   3. Android test navigates PPV flow and captures checkout URL
//
// PRE-REQUISITES:
//   - Device connected via USB with ADB authorised (run: adb devices)
//   - DAZN app installed and user already logged in (noReset: true)
//   - Appium 3.x installed globally
//
// HOW TO RUN:
//   cd appium && npm run android
//
// ENV VARS (all optional):
//   DEVICE_SERIAL    : ADB serial (auto-detected if only one device connected)
//   APP_PACKAGE      : DAZN app package  (default: com.dazn)
//   APP_ACTIVITY     : Launch activity   (default: com.dazn.splash.view.SplashScreenActivity)
// ─────────────────────────────────────────────────────────────────────────────

import { execSync, spawn, ChildProcess } from 'child_process';

const APPIUM_PORT = process.env.APPIUM_PORT ? parseInt(process.env.APPIUM_PORT, 10) : 4723;
const appiumCommand = process.env.APPIUM_PATH || 'npx appium';
let appiumProcess: ChildProcess | null = null;

const ANDROID_SDK = process.env.ANDROID_HOME || `${process.env.HOME}/Library/Android/sdk`;
const ADB         = `${ANDROID_SDK}/platform-tools/adb`;

// Export ANDROID_HOME at module level so Appium server inherits it
process.env.ANDROID_HOME     = ANDROID_SDK;
process.env.ANDROID_SDK_ROOT = ANDROID_SDK;
process.env.ADB_PATH         = ADB;

// ── Auto-detect device info via ADB ──────────────────────────────────────────
function adbShell(serial: string, cmd: string): string {
  try {
    return execSync(`${ADB} -s ${serial} ${cmd}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10000,
    }).trim();
  } catch {
    return '';
  }
}

function getConnectedDevices(): string[] {
  try {
    const out = execSync(`${ADB} devices`, { encoding: 'utf8', timeout: 10000 });
    return out
      .split('\n')
      .slice(1)
      .filter(l => l.includes('\tdevice'))
      .map(l => l.split('\t')[0].trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

// Pick device: prefer DEVICE_SERIAL env var, else first connected device
const devices    = getConnectedDevices();
const serial     = process.env.DEVICE_SERIAL || devices[0] || '';

if (!serial) {
  console.warn('⚠️  No Android device detected via ADB. Ensure USB debugging is enabled and run: adb devices');
}

// Read device model name (e.g. "SM_G990E" → "SM G990E")
const rawModel   = serial ? adbShell(serial, 'shell getprop ro.product.model') : '';
const deviceName = process.env.DEVICE_NAME || rawModel || 'Android Device';

// Read Android OS version (e.g. "15", "14", "13")
const rawVersion       = serial ? adbShell(serial, 'shell getprop ro.build.version.release') : '';
const platformVersion  = process.env.PLATFORM_VERSION || rawVersion || '';

console.log(`📱 Device   : ${deviceName} (${serial || 'no device'})`);
console.log(`🤖 Android  : ${platformVersion || 'unknown'}`);
// ─────────────────────────────────────────────────────────────────────────────

export const config = {
  runner: 'local',
  port:   4723,
  path:   '/',

  services: [],

  onPrepare: async function () {
    console.log('🧹 Clearing stale ADB port forwards...');
    try {
      execSync(`${ADB} forward --remove-all`, { stdio: 'ignore' });
    } catch {}
    console.log(`🚀 Starting Appium server manually on port ${APPIUM_PORT}...`);
    appiumProcess = spawn(appiumCommand, [
      '--port', String(APPIUM_PORT),
      '--address', '127.0.0.1',
      '--relaxed-security'
    ], {
      stdio: 'inherit',
      shell: true,
      env: { ...process.env, NODE_OPTIONS: '' }
    });
    // Wait 15 seconds for Appium to start
    await new Promise(resolve => setTimeout(resolve, 15000));
    console.log('✅ Appium server started.');
  },

  onComplete: async function () {
    if (appiumProcess) {
      console.log('🧹 Stopping Appium server...');
      appiumProcess.kill();
    }
  },

  specs:        ['../tests/android/*.spec.ts'],
  exclude:      [],
  maxInstances: 1,

  capabilities: [
    {
      platformName:                      'Android',
      'appium:deviceName':               deviceName,
      // platformVersion is optional for UiAutomator2 — omit if empty so
      // Appium matches any connected device automatically
      ...(platformVersion ? { 'appium:platformVersion': platformVersion } : {}),
      'appium:udid':                     serial || undefined,
      'appium:automationName':           'UiAutomator2',
      'appium:appPackage':               process.env.APP_PACKAGE   || 'com.dazn',
      'appium:appActivity':              process.env.APP_ACTIVITY  || 'com.dazn.splash.view.SplashScreenActivity',
      'appium:noReset':                  true,
      'appium:autoLaunch':               false,   // do NOT auto-launch at session creation
      'appium:forceAppLaunch':           false,   // do NOT force-restart if already running
      'appium:autoGrantPermissions':     true,
      'appium:unicodeKeyboard':          false,
      'appium:resetKeyboard':            false,
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