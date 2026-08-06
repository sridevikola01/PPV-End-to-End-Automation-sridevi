#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const [mode, configName, country] = process.argv.slice(2);
const configPath = path.join('config', 'events', path.basename(configName || ''));
if (!mode || !configName || !country) throw new Error('Usage: buildPpvWorkflowMatrix.js <mode> <PPV_CONFIG> <COUNTRY>');
if (!fs.existsSync(configPath)) throw new Error(`PPV config not found: ${configName}`);

const event = JSON.parse(fs.readFileSync(configPath, 'utf8'));
if (country === 'SA' && event.regions && !event.regions.SA) {
  event.regions.SA = JSON.parse(JSON.stringify(event.regions.AE || event.regions.GB || {}));
}
if (country === 'CA' && event.regions && !event.regions.CA) {
  event.regions.CA = JSON.parse(JSON.stringify(event.regions.US || event.regions.GB || {}));
}

if (process.env.PPV_DEV_MODE === 'true') {
  event.PPV_DEV_MODE = true;
} else if (process.env.PPV_DEV_MODE === 'false') {
  event.PPV_DEV_MODE = false;
}

if (process.env.DEFAULT_SIGNUP_DEVMODE === 'true') {
  event.DEFAULT_SIGNUP_DEVMODE = true;
  event.HAS_DEFAULT_SIGNUP_PPV = false;
} else if (process.env.DEFAULT_SIGNUP_DEVMODE === 'false') {
  event.DEFAULT_SIGNUP_DEVMODE = false;
  event.HAS_DEFAULT_SIGNUP_PPV = true;
}
if (!event.regions?.[country]) throw new Error(`${configName} is not available in ${country}: regions.${country} is missing.`);

const sourceConfig = JSON.parse(fs.readFileSync('config/surfacingpoint.json', 'utf8'));
const planConfig = JSON.parse(fs.readFileSync('config/DaznPlan.json', 'utf8'));
const isBoxing = String(event.SPORT || '').trim().toLowerCase() === 'boxing';
const isKickboxing = String(event.SPORT || '').toLowerCase() === 'kickboxing';
const hasBundle = event.HAS_BUNDLE === true;
const defaultSignupDevMode = event.DEFAULT_SIGNUP_DEVMODE === true;
const hasDefaultSignup = event.HAS_DEFAULT_SIGNUP_PPV === true;
// The workflow matrix must only contain plans offered in the selected country.
// `loadEventConfig` validates this too, but filtering here avoids creating CI jobs
// that are guaranteed to fail (for example, standard_apm is not offered in AE).
const requestedPlans = ['standard_monthly', 'standard_apm', 'ultimate_apm', 'ultimate_upfront'];
const standardPlans = requestedPlans.filter((plan) => planConfig[plan]?.regions?.[country]);
if (standardPlans.length === 0) {
  throw new Error(`No supported plans are configured for ${country} in DaznPlan.json.`);
}
const regularProfiles = [
  'freemium/standard_monthly', 'freemium/standard_apm', 'freemium/ultimate_apm', 'freemium/ultimate_upfront',
  'frozen/standard_monthly', 'frozen/standard_apm', 'frozen/ultimate_apm', 'frozen/ultimate_upfront',
  'active_standard_monthly/standard_monthly', 'active_standard_monthly/ultimate_apm', 'active_standard_monthly/ultimate_upfront',
  'active_standard_apm/standard_apm', 'active_standard_apm/ultimate_apm',
  'active_ultimate_apm/ultimate_apm', 'active_ultimate_upfront/ultimate_upfront',
].filter((profile) => standardPlans.includes(profile.split('/')[1]));
const ultimateOnly = new Set(['boxing-banner-ultimate', 'boxing-ultimate-subscription', 'boxing-join-the-club']);
const validUltimateProfiles = new Set(['active_standard_monthly/ultimate_apm', 'active_standard_monthly/ultimate_upfront', 'active_standard_apm/ultimate_apm']);
// Boxing PPVs are surfaced through the complete set of boxing-specific entry
// points. Other sports use the sport tile, the home-page Don't Miss tile,
// Search, Schedule, and (for authenticated users) My Account.
// `home-boxing-tile` is the legacy source key for the sport tile; the page
// object resolves the actual destination from event.SPORT.
const liveSources = {
  new: isBoxing
    ? ['boxing-banner-ultimate', 'boxing-join-the-club', 'boxing-page-banner', 'boxing-page-bundle', 'boxing-standard-subscription', 'boxing-upcoming-fights', 'boxing-ultimate-subscription', 'home-biggest-fights', 'home-boxing-banner', 'home-boxing-tile', 'home-boxing-upcoming', 'home-kickboxing-tile', 'home-page-banner', 'home-page-dazntile', 'home-page-dont-miss', 'home-page-get-started', 'landing-page-banner', 'landing-page-dont-miss-live', 'schedule', 'search']
    : ['home-boxing-tile', 'home-page-dont-miss', 'schedule', 'search'],
  existing: isBoxing
    ? ['landing-page-banner', 'home-page-banner', 'home-page-dont-miss', 'home-biggest-fights', 'home-page-dazntile', 'home-boxing-banner', 'home-boxing-tile', 'home-boxing-upcoming', 'home-kickboxing-tile', 'boxing-page-banner', 'boxing-page-bundle', 'boxing-upcoming-fights', 'boxing-banner-ultimate', 'boxing-ultimate-subscription', 'boxing-standard-subscription', 'boxing-join-the-club', 'search', 'schedule', 'myaccount']
    : ['home-boxing-tile', 'home-page-dont-miss', 'schedule', 'search', 'myaccount'],
  signed: isBoxing
    ? ['home-page-banner', 'home-page-dont-miss', 'home-biggest-fights', 'home-page-dazntile', 'home-boxing-banner', 'home-boxing-tile', 'home-boxing-upcoming', 'home-kickboxing-tile', 'boxing-page-banner', 'boxing-page-bundle', 'boxing-upcoming-fights', 'boxing-banner-ultimate', 'boxing-ultimate-subscription', 'boxing-standard-subscription', 'boxing-join-the-club', 'search', 'schedule', 'myaccount']
    : ['home-boxing-tile', 'home-page-dont-miss', 'schedule', 'search', 'myaccount'],
};
let androidNewSources = ['landing-page-banner', 'home-page-banner', 'home-page-dont-miss', 'home-boxing-banner', 'home-boxing-upcoming', 'home-boxing-tile', 'schedule', 'search'];
let androidExistingSources = androidNewSources.filter(source => source !== 'landing-page-banner');
const androidProfiles = regularProfiles;
const androidDevices = [
  { deviceSerial: 'RZCW308EJKZ', appiumPort: 4723, appiumSystemPort: 8200, chromedriverPort: 9515 },
  { deviceSerial: 'RZCX22324AF', appiumPort: 4724, appiumSystemPort: 8201, chromedriverPort: 9516 },
];
const assignAndroidDevices = (entries) => entries.map((entry, index) => ({ ...entry, ...androidDevices[index % androidDevices.length] }));

const filterBanners = (sources) => {
  if (process.env.BANNERS_CONFIGURED === 'false') {
    return sources.filter(source => !source.toLowerCase().includes('banner'));
  }
  if (process.env.BANNERS_CONFIGURED === 'true') {
    return sources.filter(source => source.toLowerCase().includes('banner'));
  }
  return sources;
};

androidNewSources = filterBanners(androidNewSources);
androidExistingSources = filterBanners(androidExistingSources);

const applicable = (sources, allowDefaultSignup = hasDefaultSignup) => {
  const filtered = sources.filter((source) => {
    if (source === 'home-kickboxing-tile' && !isKickboxing) return false;
    if (source === 'boxing-page-bundle' && !hasBundle) return false;
    return !sourceConfig[source]?.defaultSignup || allowDefaultSignup;
  });
  return filterBanners(filtered);
};
const withOutput = (name, value) => fs.appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${JSON.stringify(value)}\n`);

let matrix;
switch (mode) {
  case 'dev-account':
    if (event.PPV_DEV_MODE !== true) throw new Error(`${configName} requires PPV_DEV_MODE: true for this workflow.`);
    matrix = [
      ...standardPlans.map((plan) => ({ source: 'myaccount', profile: `freemium/${plan}` })),
      ...standardPlans.map((plan) => ({ source: 'myaccount', profile: `frozen/${plan}` })),
      { source: 'myaccount', profile: 'active_standard_monthly/standard_monthly' },
      { source: 'myaccount', profile: 'active_standard_monthly/ultimate_apm' },
      { source: 'myaccount', profile: 'active_standard_monthly/ultimate_upfront' },
      { source: 'myaccount', profile: 'active_standard_apm/standard_apm' },
      { source: 'myaccount', profile: 'active_standard_apm/ultimate_apm' },
      { source: 'myaccount', profile: 'active_ultimate_apm/ultimate_apm' },
      { source: 'myaccount', profile: 'active_ultimate_upfront/ultimate_upfront' },
    ];
    break;
  case 'live-new': {
    const sources = applicable(liveSources.new, false);
    matrix = sources.flatMap((source) => standardPlans.filter((plan) => !ultimateOnly.has(source) || plan.startsWith('ultimate_')).map((plan) => ({ source, plan })));
    if (isBoxing) {
      matrix.push({ source: 'landing-page-dont-miss-live-switch', plan: 'standard_monthly', switch: 'true' }, { source: 'landing-page-dont-miss-live-switch', plan: 'standard_apm', switch: 'true' });
    }
    break;
  }
  case 'live-existing': {
    const sources = applicable(liveSources.existing, false);
    matrix = sources.flatMap((source) => regularProfiles.filter((profile) => !ultimateOnly.has(source) || validUltimateProfiles.has(profile)).map((profile) => ({ source, profile })));
    if (isBoxing) {
      matrix.push({ source: 'landing-page-dont-miss-live-switch', profile: 'freemium/standard_monthly', switch: 'true' }, { source: 'landing-page-dont-miss-live-switch', profile: 'freemium/standard_apm', switch: 'true' });
    }
    break;
  }
  case 'live-signed': {
    const sources = applicable(liveSources.signed, false);
    matrix = sources.flatMap((source) => regularProfiles.filter((profile) => !ultimateOnly.has(source) || validUltimateProfiles.has(profile)).map((profile) => ({ source, profile })));
    break;
  }
  case 'android-full-new': matrix = assignAndroidDevices(androidNewSources.flatMap(source => standardPlans.map(plan => ({ source, plan })))); break;
  case 'android-full-signin': matrix = assignAndroidDevices(androidNewSources.flatMap(source => androidProfiles.map(profile => ({ source, profile })))); break;
  case 'android-full-signed': matrix = assignAndroidDevices(androidExistingSources.flatMap(source => androidProfiles.map(profile => ({ source, profile })))); break;
  case 'android-sanity-new': matrix = assignAndroidDevices(androidNewSources.map((source, index) => ({ source, plan: standardPlans[index % standardPlans.length] }))); break;
  case 'android-sanity-signin': matrix = assignAndroidDevices(androidNewSources.map((source, index) => ({ source, profile: androidProfiles[index] }))); break;
  case 'android-sanity-signed': matrix = assignAndroidDevices(androidExistingSources.map((source, index) => ({ source, profile: androidProfiles[index + androidNewSources.length] }))); break;
  case 'default-new':
    matrix = ['boxing-standard-subscription', 'home-page-get-started', 'home-page-dazntile'].flatMap((source) => standardPlans.map((plan) => ({ source, plan })));
    matrix.push({ source: 'subscribe-without-pay-per-view', plan: 'standard_monthly' });
    break;
  case 'default-signin':
    matrix = ['boxing-standard-subscription', 'home-page-get-started', 'home-page-dazntile'].flatMap((source) => standardPlans.flatMap((plan) => [{ source, profile: `freemium/${plan}` }, { source, profile: `frozen/${plan}` }]));
    matrix.push({ source: 'subscribe-without-pay-per-view', profile: 'freemium/standard_monthly' });
    break;
  case 'default-signed':
    matrix = [
      ...['boxing-standard-subscription', 'home-page-dazntile'].flatMap((source) => standardPlans.flatMap((plan) => [{ source, profile: `freemium/${plan}` }, { source, profile: `frozen/${plan}` }])),
      ...standardPlans.map((plan) => ({ source: 'home-page-subscribe', profile: `freemium/${plan}` })),
      ...standardPlans.map((plan) => ({ source: 'myaccount', profile: `freemium/${plan}`, scenario: 'upgrade' })),
      ...standardPlans.map((plan) => ({ source: 'myaccount-subscription-status', profile: `frozen/${plan}`, scenario: 'resubscribe' })),
      { source: 'subscribe-without-pay-per-view', profile: 'freemium/standard_monthly' },
    ];
    break;
  case 'removal-new': {
    const sources = applicable(liveSources.new, true);
    matrix = sources.map((source) => ({ source, plan: standardPlans[0] }));
    break;
  }
  case 'removal-signed': {
    const sources = applicable(liveSources.signed, true);
    matrix = sources.map((source) => ({ source, profile: `freemium/${standardPlans[0]}` }));
    break;
  }
  default: throw new Error(`Unsupported matrix mode: ${mode}`);
}

// Keep every matrix mode consistent, including explicitly-added switch jobs.
// New-user jobs use `plan`; authenticated jobs encode the destination plan in
// the last segment of `profile` (for example, freemium/standard_apm).
matrix = matrix.filter((entry) => {
  const plan = entry.plan || entry.profile?.split('/').pop();
  return standardPlans.includes(plan);
});

if (country === 'SA') {
  const existingModes = [
    'live-existing',
    'live-signed',
    'android-full-signin',
    'android-full-signed',
    'android-sanity-signin',
    'android-sanity-signed'
  ];
  if (existingModes.includes(mode)) {
    matrix = [];
  }
}

if (mode.startsWith('default-') && !defaultSignupDevMode && !hasDefaultSignup) {
  throw new Error(`${configName} does not enable default signup (set DEFAULT_SIGNUP_DEVMODE or HAS_DEFAULT_SIGNUP_PPV to true).`);
}
console.log(`Validated ${configName} for ${country}; ${matrix.length} ${mode} jobs.`);
withOutput('matrix', matrix);
if (mode.startsWith('default-')) fs.appendFileSync(process.env.GITHUB_OUTPUT, `dev_mode_on=${defaultSignupDevMode ? 'on' : 'off'}\n`);
