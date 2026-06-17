import * as XLSX from 'xlsx';

let FILE_PATH = 'data/PPV_Input.xlsx';

export function configureExcelPathForEvent(eventKey: string) {
  FILE_PATH = 'data/PPV_Input.xlsx';
  console.log(`📊 excelReader configured path: ${FILE_PATH}`);
}

// =========================
// READ SHEET
// =========================
export const readSheet = (sheetName: string) => {
  const workbook = XLSX.readFile(FILE_PATH);
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    const available = workbook.SheetNames.join(', ');
    throw new Error(
      `❌ Sheet not found: "${sheetName}"\n` +
      `   Available sheets: ${available}`
    );
  }

  const rawData: any[] = XLSX.utils.sheet_to_json(sheet);

  if (!rawData.length) {
    throw new Error(`❌ Sheet is empty: "${sheetName}"`);
  }

  return rawData;
};

// =========================
// LANDING DATA (Field | Value)
// =========================
export const getLandingData = () => {
  const data = readSheet('Landing page');
  console.log(`📊 Landing rows: ${data.length}`);
  return data;
};

// =========================
// PPV DATA BY VARIANT (Variant | Field | Expected)
// =========================
export const getPPVDataByVariant = (variant: string) => {
  const data = readSheet('PPV page');

  const normalize = (val: any) =>
    val?.toString().trim().toLowerCase();

  // If no Variant column exists, return all rows (backward compatible)
  if (data.length > 0 && !('Variant' in data[0])) {
    console.log('ℹ️  No Variant column in PPV page — returning all rows');
    return data;
  }

  const variantData = data.filter(
    (d: any) => normalize(d.Variant) === normalize(variant)
  );

  if (!variantData.length) {
    const available = [...new Set(data.map((d: any) => d.Variant))].join(', ');
    throw new Error(
      `❌ No data found for variant: "${variant}"\n` +
      `   Available variants: ${available}`
    );
  }

  console.log(`🧠 Variant: ${variant}`);
  console.log(`📊 PPV rows: ${variantData.length}`);

  return variantData;
};

// =========================
// PLAN DATA BY TIER (Tier | Field | Expected)
// =========================
export const getPlanDataByTier = (tier: string) => {
  const data = readSheet('Dazn Plan page');

  const normalize = (val: any) =>
    val?.toString().trim().toLowerCase();

  // If no Tier column exists, return all rows (backward compatible)
  if (data.length > 0 && !('Tier' in data[0])) {
    console.log('ℹ️  No Tier column in Dazn Plan page — returning all rows');
    return data;
  }

  const tierData = data.filter(
    (d: any) => normalize(d.Tier) === normalize(tier)
  );

  if (!tierData.length) {
    const available = [...new Set(
      data.map((d: any) => d.Tier).filter(Boolean)
    )].join(', ');
    throw new Error(
      `❌ No data found for tier: "${tier}"\n` +
      `   Available tiers: ${available}`
    );
  }

  console.log(`💎 Tier     : ${tier}`);
  console.log(`📊 Plan rows: ${tierData.length}`);

  return tierData;
};

// =========================
// PAYMENT DATA BY TIER & RATE PLAN (Tier | Rate Plan | Field | Expected)
// =========================
export const getPaymentDataByTierAndPlan = (
  tier: string,
  ratePlan: string
) => {
  const data = readSheet('Payment page');

  const normalize = (val: any) =>
    val?.toString().trim().toLowerCase();

  // If no Tier column exists, return all rows (backward compatible)
  if (data.length > 0 && !('Tier' in data[0])) {
    console.log('ℹ️  No Tier column in Payment page — returning all rows');
    return data;
  }

  if (data.length > 0 && !('Rate Plan' in data[0])) {
    console.log('ℹ️  No Rate Plan column in Payment page — filtering by Tier only');
    return data.filter((d: any) => normalize(d.Tier) === normalize(tier));
  }

  // Common rows (apply to all tier/plan combos)
  const commonData = data.filter(
    (d: any) =>
      normalize(d.Tier) === 'common' &&
      normalize(d['Rate Plan']) === 'all'
  );

  // Specific rows for this tier + rate plan
  const tierPlanData = data.filter(
    (d: any) =>
      normalize(d.Tier) === normalize(tier) &&
      normalize(d['Rate Plan']) === normalize(ratePlan)
  );

  if (!tierPlanData.length) {
    const available = [
      ...new Set(
        data
          .filter((d: any) => d.Tier && d['Rate Plan'])
          .map((d: any) => `${d.Tier} - ${d['Rate Plan']}`)
      ),
    ].join(', ');
    throw new Error(
      `❌ No data found for tier: "${tier}" + rate plan: "${ratePlan}"\n` +
      `   Available combinations: ${available}`
    );
  }

  const combined = [...commonData, ...tierPlanData];

  console.log(`💎 Tier          : ${tier}`);
  console.log(`📋 Rate Plan     : ${ratePlan}`);
  console.log(`📊 Common rows   : ${commonData.length}`);
  console.log(`📊 Specific rows : ${tierPlanData.length}`);
  console.log(`📊 Total rows    : ${combined.length}`);

  return combined;
};

// =========================
// MY ACCOUNT DATA
// =========================
export const getMyAccountData = () => {
  const data = readSheet('My Account page');
  console.log(`📊 My Account rows: ${data.length}`);
  return data;
};

// =========================
// PAY PER VIEW LISTING DATA
// =========================
export const getPayPerViewData = () => {
  try {
    const data = readSheet('Pay Per View page');
    console.log(`📊 Pay Per View rows: ${data.length}`);
    return data;
  } catch {
    console.log('ℹ️  No Pay Per View page sheet found — skipping');
    return [];
  }
};

// =========================
// CHOOSE HOW TO BUY DATA
// =========================
export const getChooseHowToBuyData = () => {
  const data = readSheet('Choose How To Buy page');
  console.log(`📊 Choose How To Buy rows: ${data.length}`);
  return data;
};

// =========================
// PPV PAYMENT DATA
// =========================
export const getPPVPaymentData = () => {
  const data = readSheet('PPV Payment page');
  console.log(`📊 PPV Payment rows: ${data.length}`);
  return data;
};

// =========================
// UPGRADE CONFIRMATION DATA BY RATE PLAN
// =========================
export const getUpgradeConfirmationData = (ratePlan: string) => {
  const data = readSheet('Upgrade Confirmation page');

  const normalize = (val: any) =>
    val?.toString().trim().toLowerCase();

  const commonData = data.filter(
    (d: any) => normalize(d.Tier) === 'common'
  );

  const ratePlanData = data.filter(
    (d: any) => normalize(d.Tier) === normalize(ratePlan)
  );

  if (!ratePlanData.length) {
    const available = [...new Set(
      data.map((d: any) => d.Tier).filter(Boolean)
    )].join(', ');
    throw new Error(
      `❌ No data found for rate plan: "${ratePlan}"\n` +
      `   Available: ${available}`
    );
  }

  const combined = [...commonData, ...ratePlanData];

  console.log(`📋 Rate Plan     : ${ratePlan}`);
  console.log(`📊 Total rows    : ${combined.length}`);

  return combined;
};

// =========================
// PHONE NUMBER PAGE DATA
// =========================
export const getPhonePageData = () => {
  const data = readSheet('Phone Number page');
  console.log(`📱 Phone page rows: ${data.length}`);
  return data;
};

// =========================
// OTP VERIFICATION PAGE DATA
// =========================
export const getOTPPageData = () => {
  const data = readSheet('OTP page');
  console.log(`🔑 OTP page rows: ${data.length}`);
  return data;
};

// =========================
// HOME OF BOXING DATA BY FLOW
// =========================
export const getHomeOfBoxingData = (flowName: string) => {
  const data = readSheet('Home of Boxing');
  const normalize = (val: any) => val?.toString().trim().toLowerCase();
  const queryFlow = flowName === 'home-boxing-upcoming' ? 'home-boxing-tile' : flowName;
  const flowData = data.filter(
    (d: any) => normalize(d.Flow) === normalize(queryFlow)
  );
  console.log(`🥊 Home of Boxing Flow: ${flowName} (mapped to ${queryFlow})`);
  console.log(`📊 Home of Boxing rows: ${flowData.length}`);
  return flowData;
};

// =========================
// HOME PAGE DATA BY FLOW
// =========================
export const getHomePageData = (flowName: string) => {
  const data = readSheet('Home page');
  const normalize = (val: any) => val?.toString().trim().toLowerCase();
  const flowData = data.filter(
    (d: any) => normalize(d.Flow) === normalize(flowName)
  );
  console.log(`🏠 Home Page Flow: ${flowName}`);
  console.log(`📊 Home Page rows: ${flowData.length}`);
  return flowData;
};

// =========================
// STANDALONE PPV PAGE DATA
// =========================
export const getStandalonePPVPageData = () => {
  const data = readSheet('Standalone PPV page');
  console.log(`📊 Standalone PPV page rows: ${data.length}`);
  return data;
};

// =========================
// UPSELL FIRST SUCCESS PAGE
// =========================
export const getUpsellFirstSuccessData = () => {
  try {
    const data = readSheet('Upsell First Success page');
    console.log(`📊 Upsell First Success rows: ${data.length}`);
    return data;
  } catch {
    console.log('ℹ️ No Upsell First Success page sheet');
    return [];
  }
};

// =========================
// UPSELL SECOND SUCCESS PAGE
// =========================
export const getUpsellSecondSuccessData = () => {
  try {
    const data = readSheet('Upsell Second Success page');
    console.log(`📊 Upsell Second Success rows: ${data.length}`);
    return data;
  } catch {
    console.log('ℹ️ No Upsell Second Success page sheet');
    return [];
  }
};

// =========================
// UPSELL PAYMENT PAGE
// =========================
export const getUpsellPaymentData = () => {
  try {
    const data = readSheet('Upsell Payment page');
    console.log(`📊 Upsell Payment rows: ${data.length}`);
    return data;
  } catch {
    console.log('ℹ️ No Upsell Payment page sheet');
    return [];
  }
};