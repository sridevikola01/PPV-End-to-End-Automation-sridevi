import fs from 'fs';
import path from 'path';

function deepMerge(base: any, override: any): any {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    if (
      override[key] !== null &&
      typeof override[key] === 'object' &&
      !Array.isArray(override[key]) &&
      base[key] !== undefined &&
      typeof base[key] === 'object'
    ) {
      result[key] = deepMerge(base[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }
  return result;
}

function alignRegions(data: any) {
  if (!data || !data.regions) return;
  const gb = data.regions.GB;
  const uk = data.regions.UK;
  // Backward-compat: if an old config only has UK, copy it to GB
  if (uk && !gb) {
    data.regions.GB = deepMerge({}, uk);
  }
  // Clean up: remove UK key entirely so only GB is used
  if (data.regions.UK) {
    delete data.regions.UK;
  }
}

function findConfig(dir: string, filename: string): string | null {
  if (!fs.existsSync(dir)) return null;

  // 1. Check config/events/filename first if dir is config/
  const eventsDir = path.join(dir, 'events');
  if (fs.existsSync(eventsDir)) {
    const eventsPath = path.join(eventsDir, filename);
    if (fs.existsSync(eventsPath) && fs.statSync(eventsPath).isFile()) {
      return eventsPath;
    }
  }

  // 2. Check config/filename
  const directPath = path.join(dir, filename);
  if (fs.existsSync(directPath) && fs.statSync(directPath).isFile()) {
    return directPath;
  }

  // 3. Recursively search other directories
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== 'events') {
      const found = findConfig(path.join(dir, entry.name), filename);
      if (found) return found;
    }
  }
  return null;
}

export function loadEventConfig(eventConfigOrKey?: string, planKeyOverride?: string): Record<string, any> {
  const configSource = process.env.PPV_CONFIG || process.env.PPV_EVENT || eventConfigOrKey || 'ppv_t_joshua_prenga.json';
  
  let filePath: string | null = null;
  
  // If it's a direct path that exists, use it
  if (fs.existsSync(configSource) && fs.statSync(configSource).isFile()) {
    filePath = configSource;
  } else {
    // Determine the filename to search recursively under config/
    let filename = path.basename(configSource);
    if (!filename.toLowerCase().endsWith('.json')) {
      filename += '.json';
    }
    const configDir = path.resolve(process.cwd(), 'config');
    filePath = findConfig(configDir, filename);
  }

  if (!filePath) {
    throw new Error(`❌ Configuration file "${configSource}" not found recursively under config/`);
  }

  // Load and parse event configuration directly
  let eventData: any = {};
  try {
    eventData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    console.log(`📄 Loaded event configuration file: ${filePath}`);
  } catch (err: any) {
    throw new Error(`❌ Failed to parse event config file ${filePath}: ${err.message}`);
  }

  // Load plan data if needed
  const planKey = planKeyOverride || process.env.PLAN || 'standard_monthly';
  const configDir = path.resolve(process.cwd(), 'config');
  const plansPath = path.join(configDir, 'DaznPlan.json');
  let planData: any = {};

  if (fs.existsSync(plansPath)) {
    try {
      const plans = JSON.parse(fs.readFileSync(plansPath, 'utf-8'));
      planData = plans[planKey] || {};
    } catch (err: any) {
      console.warn(`⚠️ Failed to parse DaznPlan.json:`, err.message);
    }
  }

  // Validate that the selected plan supports the target region
  const region = process.env.DAZN_REGION || 'GB';
  if (planData.regions && Object.keys(planData.regions).length > 0) {
    const planRegions = Object.keys(planData.regions);
    if (!planRegions.includes(region)) {
      const planDisplayName = `${planData.TIER || 'unknown'} ${planData.RATE_PLAN || planKey}`.trim();
      throw new Error(
        `❌ No "${planDisplayName}" plan available for region "${region}".\n` +
        `   Available regions for this plan: ${planRegions.join(', ')}\n` +
        `   Please choose a different plan or region.`
      );
    }
  }

  alignRegions(planData);
  alignRegions(eventData);

  let merged = deepMerge(planData, eventData);
  merged.eventKey = path.basename(filePath, '.json');
  merged.planKey = planKey;

  return merged;
}
