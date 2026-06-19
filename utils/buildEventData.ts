import * as fs from 'fs';
import * as path from 'path';
import {
  formatNextPaymentDate,
  formatNextPaymentDateMonthly,
  formatNextPaymentDateYearly,
  formatNextPaymentDateMonthlyUS,
  formatNextPaymentDateYearlyUS,
  formatNextPaymentDateUS,
  formatFlexFutureDate,
  formatRenewalDate,
  formatRenewalDateUS,
} from './dateUtils';

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


const GLOBAL_DEFAULTS: Record<string, string> = {
  PPV_CTA_TEXT: "Continue with pay-per-view",
  PLAN_PAGE_TITLE: "Choose a plan that's right for you|Choose the right plan for you|Choose the right plan for you.|Choose your plan|Choose a plan",
  PLAN_CTA_BUTTON_STANDARD: "Continue with 7-day Free Trial",
  PLAN_CTA_BUTTON_ULTIMATE: "Continue with DAZN Ultimate",
  PPV_PAGE_TITLE: "Choose the right plan for you.",
  PPV_PAGE_SUBTITLE: "To watch your pay-per-view, you'll need a DAZN plan.",
  UPSELL_BADGE: "The Ultimate Fan Package",
  UPSELL_OFFER_TEXT: "N/A",
  UPSELL_SECTION_HEADING: "All these fights included and more.",
  UPSELL_FEATURE_1: "Minimum 12 pay-per-views a year included at no extra cost.",
  UPSELL_FEATURE_2: "185+ fights a year from the world's best promoters.",
  UPSELL_FEATURE_3: "HDR and Dolby 5.1 surround sound on select events.",
  FLEX_BADGE: "7 DAY FREE TRIAL",
  FLEX_DESCRIPTION: "Only pay for the fight. Cancel anytime before the end of the trial.",
  FLEX_TODAY_TEXT: "Only pay for the fight and start your 7-day free trial of DAZN Standard",
  FLEX_FUTURE_TEXT: "You will start your DAZN Standard plan at {{CURRENCY}}{{MONTHLY_PRICE}}/month. Cancel anytime before the end of the trial.",
  ANNUAL_BADGE: "1 MONTH FREE",
  ANNUAL_SAVINGS_BADGE: "SAVE {{CURRENCY}}135.99 A YEAR",
  ANNUAL_PRICE_TEXT: "then {{CURRENCY}}{{ANNUAL_PRICE}}/month for 11 months",
  ANNUAL_FEATURE_1: "185+ fights a year from the world's best promoters.",
  ANNUAL_FEATURE_2: "Additional cost for pay-per-view events.",
  ANNUAL_FEATURE_3: "Full HD video resolution.",
  ANNUAL_PAY_MONTHLY_CONTRACT_TEXT: "Annual contract. Auto renews.",
  ANNUAL_PAY_UPFRONT_CONTRACT_TEXT: "",
  PAYMENT_PAGE_TITLE_TRIAL: "Choose how to pay after your free trial",
  PAYMENT_PAGE_TITLE_STANDARD: "Choose how to pay",
  PAYMENT_FREE_TEXT_TRIAL: "7-days free",
  PAYMENT_FREE_TEXT_MONTHLY: "First month free",
  CANCELLATION_TEXT_TRIAL: "In 7 days, you'll be charged {{CURRENCY}}{{MONTHLY_PRICE}}/month. Cancel anytime before the end of the trial.",
  CANCELLATION_TEXT_ANNUAL: "First month free, then {{CURRENCY}}{{ANNUAL_PRICE}}/month for 11 months ({{CURRENCY}}{{ANNUAL_TOTAL}} total over 12 months). 12-month minimum term. On {{RENEWAL_DATE}} your plan renews automatically|First month free, then {{CURRENCY}}{{ANNUAL_PRICE}}/month for 11 months",
  CANCELLATION_TEXT_ULTIMATE_APM: "Your Annual (pay over time) plan will renew automatically on {{RENEWAL_DATE}}. Manage or cancel your annual renewal anytime in My Account. 12-month minimum term",
  CANCELLATION_TEXT_ULTIMATE_APU: "You can cancel the renewal to this subscription in My Account. You will still have full access to DAZN until the end of your annual cycle.",
  ULTIMATE_FEATURE_2: "Every match from Lega Serie A, and highlights from LALIGA, Bundesliga and the Saudi Pro League.",
  ULTIMATE_FEATURE_3: "HDR and Dolby 5.1 surround sound on select events.",
  UPSELL_CROSSED_PRICE: "N/A",
  BUNDLE_MONTHLY_PRICE: "N/A"
};

export function buildEventData(
  json: any,
  region: string,
  tier?: string,
  ratePlan?: string,
  source?: string
): Record<string, any> {

  const merged = json;
  const regionalBase = {};

  let eventRegional = json.regions?.[region];
  if (!eventRegional) {
    // Backward-compat: if region is GB but config only has UK
    if (region === 'GB') {
      eventRegional = json.regions?.UK;
    }
  }

  if (!eventRegional) {
    const available = Object.keys(json.regions || {}).join(', ');
    throw new Error(
      `❌ Region "${region}" not found in config.\n` +
      `   Available regions: ${available}`
    );
  }

  const regional = deepMerge(deepMerge(GLOBAL_DEFAULTS, regionalBase), eventRegional);

  const base: Record<string, any> = {
    PPV_NAME:      merged.PPV_NAME,
    SECONDARY_PPV: merged.SECONDARY_PPV,
    ...merged.global,
    ...regional,
  };

  // OFFER_TYPE comes from regional data (DaznPlan.json per region) — not all countries have 7-day trial
  if (!base.OFFER_TYPE) {
    base.OFFER_TYPE = '1_month_free';
  }

  const env = (process.env.DAZN_ENV || 'stag').toLowerCase();
  let domain = 'stag.dazn.com';
  if (env === 'beta') domain = 'beta.dazn.com';
  if (env === 'prod') domain = 'www.dazn.com';

  if (base.BASE_URL) {
    base.BASE_URL = base.BASE_URL.replace(/(www\.)?dazn\.com/, domain);
  }

  base.TIER      = (tier || merged.TIER      || 'standard').toLowerCase();
  base.RATE_PLAN = (ratePlan || merged.RATE_PLAN || 'monthly').toLowerCase();

  console.log(`💎 Tier      : ${base.TIER}`);
  console.log(`📋 Rate Plan : ${base.RATE_PLAN}`);



  const getPriceWithCurrency = (val: string) => {
    if (!val) return '';
    const curr = base.CURRENCY || '';
    return val.startsWith(curr) ? val : `${curr}${val}`;
  };

  // Default TODAY_YOU_PAY_PRICE for ultimate tier (as PPV is included in Ultimate)
  if (base.TIER === 'ultimate') {
    if (base.ULTIMATE_ANNUAL_PAY_MONTHLY_PRICE) {
      base.ANNUAL_PAY_MONTHLY_PRICE = base.ULTIMATE_ANNUAL_PAY_MONTHLY_PRICE;
    } else if (base.UPSELL_PRICE) {
      base.ANNUAL_PAY_MONTHLY_PRICE = base.UPSELL_PRICE;
    }

    if (base.RATE_PLAN === 'annual pay upfront') {
      base.TODAY_YOU_PAY_PRICE = base.ANNUAL_UPFRONT_PRICE;
    } else if (base.RATE_PLAN === 'annual pay monthly') {
      if (base.TODAY_YOU_PAY_ULTIMATE_APM) {
        base.TODAY_YOU_PAY_PRICE = base.TODAY_YOU_PAY_ULTIMATE_APM;
      } else {
        base.TODAY_YOU_PAY_PRICE = base.ANNUAL_PAY_MONTHLY_PRICE;
      }
    }
  }

   // Load DaznPlan.json dynamically to read plan-level offers
  const plansPath = path.resolve(process.cwd(), 'config/DaznPlan.json');
  let plans: any = {};
  try {
    plans = JSON.parse(fs.readFileSync(plansPath, 'utf-8'));
  } catch (e: any) {
    console.warn('⚠️ buildEventData: Failed to read DaznPlan.json:', e.message);
  }

  const planKey = json.planKey || 'standard_monthly';
  const planData = plans[planKey];
  const planRegionalOffers = planData?.regions?.[region.toUpperCase()]?.offers || [];
  const eventRegionalOffers = eventRegional?.offers || [];

  // Combine offers: event-level offers override plan-level offers by name
  const allOffers = [...eventRegionalOffers];
  for (const planOffer of planRegionalOffers) {
    if (!allOffers.some(o => o.name === planOffer.name)) {
      allOffers.push(planOffer);
    }
  }

  // Filter offers matching current environment, region, and enabled flag
  const matchedOffers = allOffers.filter(offer => {
    if (offer.enabled !== true) return false;

    // Match environment
    const targetEnvs = offer.environments || ['stag', 'beta', 'prod'];
    if (!targetEnvs.includes(env)) return false;

    // Match region (backward compat)
    if (offer.target_region && offer.target_region.length > 0) {
      const matchedRegion = offer.target_region.some((r: string) => r.toUpperCase() === region.toUpperCase());
      if (!matchedRegion) return false;
    }

    return true;
  });

  let activeOffer: any = null;
  let activeOfferType: string = 'default';

  // Identify flow context
  const sourceLower = (source || '').toLowerCase();
  const isBundleFlow = sourceLower.includes('bundle');
  const isPPVFlow = sourceLower.includes('ppv') || json.PPV_TYPE === 'standalone';

  // Contextual Precedence:
  if (isBundleFlow) {
    activeOffer = matchedOffers.find(o => o.name === 'bundle_offer');
    if (activeOffer) activeOfferType = 'bundle_offer';
  } else if (isPPVFlow) {
    activeOffer = matchedOffers.find(o => o.name === 'ppv_only_offer');
    if (activeOffer) activeOfferType = 'ppv_only_offer';
  } else {
    // Subscription Flow / Upsell Flow
    if (base.TIER === 'ultimate' && base.RATE_PLAN === 'annual pay monthly') {
      activeOffer = matchedOffers.find(o => o.name === 'ultimate_offer');
      if (activeOffer) activeOfferType = 'ultimate_offer';
    } else if (base.TIER === 'standard' && base.RATE_PLAN === 'monthly') {
      activeOffer = matchedOffers.find(o => o.name === 'standard_flex_offer');
      if (activeOffer) activeOfferType = 'standard_flex_offer';
    }
  }

  // Map active offer parameters dynamically if present
  if (activeOffer) {
    base.ACTIVE_OFFER_PRESENT = 'true';
    base.ACTIVE_OFFER_TYPE = activeOfferType;
    base.ACTIVE_OFFER = activeOffer;

    // Dynamically assign all keys from activeOffer to base
    Object.assign(base, activeOffer);

    // Format derived values
    const offerPrice = getPriceWithCurrency(activeOffer.OFFER_PRICE);
    const origPrice = getPriceWithCurrency(activeOffer.ORIGINAL_PRICE);

    base.DISCOUNT_BADGE = activeOffer.DISCOUNT_BADGE || 'N/A';
    if (activeOffer.PLAN_LABEL) {
      base.PAYMENT_PLAN_LABEL = activeOffer.PLAN_LABEL;
      base.RATE_PLAN_LABEL = activeOffer.PLAN_LABEL;
    }
    if (origPrice) {
      base.RATE_PLAN_ORIGINAL_PRICE = origPrice;
    }

    // Handle specific offer types
    if (activeOfferType === 'bundle_offer') {
      base.BUNDLE_PRICE = offerPrice;
      base.BUNDLE_ORIGINAL_PRICE = origPrice;
      base.BUNDLE_DISCOUNT = activeOffer.DISCOUNT_BADGE || '';
      base.BUNDLE_SAVE_BADGE = activeOffer.DISCOUNT_BADGE || '';
      base.BUNDLE_OFFER_PRICE = offerPrice;
      base.BUNDLE_OFFER_ORIGINAL_PRICE = origPrice;
      base.BUNDLE_OFFER_DISCOUNT_AMOUNT = activeOffer.DISCOUNT_BADGE || '';
      base.BUNDLE_OFFER_SAVE_BADGE = activeOffer.DISCOUNT_BADGE || '';
      base.BUNDLE_OFFER_DESCRIPTION = activeOffer.OFFER_DESCRIPTION || '';
      base.TODAY_YOU_PAY_PRICE = offerPrice;
    } else if (activeOfferType === 'ppv_only_offer') {
      base.OFFER_EFFECTIVE_PPV_PRICE = offerPrice;
      base.OFFER_ORIGINAL_PPV_PRICE = origPrice;
      base.OFFER_DISCOUNT_AMOUNT = activeOffer.DISCOUNT_BADGE || '0';
      base.OFFER_BADGE = activeOffer.DISCOUNT_BADGE || '';
      base.OFFER_DESCRIPTION = activeOffer.OFFER_DESCRIPTION || '';
      base.TODAY_YOU_PAY_PRICE = offerPrice;
    } else if (activeOfferType === 'standard_flex_offer') {
      base.FLEX_OFFER_PRICE = offerPrice;
      base.FLEX_ORIGINAL_PRICE = origPrice;
      base.PLAN_CTA_BUTTON_STANDARD = "Continue with Flex - Pay Monthly";
      base.CANCELLATION_TEXT_TRIAL = activeOffer.CANCELLATION_TEXT || '';
      base.TODAY_YOU_PAY_PRICE = activeOffer.TODAY_YOU_PAY ? getPriceWithCurrency(activeOffer.TODAY_YOU_PAY) : offerPrice;
      if (activeOffer.TODAY_YOU_PAY_ORIGINAL) {
        base.TODAY_YOU_PAY_ORIGINAL_PRICE = getPriceWithCurrency(activeOffer.TODAY_YOU_PAY_ORIGINAL);
      }

      // Dynamic Annual Savings Badge calculation
      const flexOfferPriceNum = parseFloat(activeOffer.OFFER_PRICE);
      const flexOrigPriceNum = parseFloat(activeOffer.ORIGINAL_PRICE || base.MONTHLY_PRICE || '25.99');
      const annualPriceNum = parseFloat(base.ANNUAL_PRICE || '15.99');
      if (!isNaN(flexOfferPriceNum) && !isNaN(flexOrigPriceNum) && !isNaN(annualPriceNum)) {
        const savingsVal = flexOfferPriceNum + (flexOrigPriceNum * 11) - (annualPriceNum * 11);
        base.ANNUAL_SAVINGS_BADGE = `SAVE ${base.CURRENCY}${savingsVal.toFixed(2).replace('.00', '')} A YEAR`;
      }
    } else if (activeOfferType === 'ultimate_offer') {
      base.ANNUAL_PAY_MONTHLY_PRICE = offerPrice;
      base.ANNUAL_PAY_MONTHLY_ORIGINAL_PRICE = origPrice;
      base.UPSELL_PRICE = offerPrice;
      base.UPSELL_ORIGINAL_PRICE = origPrice;
      base.UPSELL_CROSSED_PRICE = origPrice;
      base.UPSELL_OFFER_TEXT = activeOffer.OFFER_DESCRIPTION || '';
      base.CANCELLATION_TEXT_ULTIMATE_APM = activeOffer.CANCELLATION_TEXT || '';
      base.ANNUAL_PAY_MONTHLY_CONTRACT_TEXT = activeOffer.OFFER_DESCRIPTION || '';
      base.TODAY_YOU_PAY_PRICE = offerPrice;
    }
  } else {
    base.ACTIVE_OFFER_PRESENT = 'false';
    base.ACTIVE_OFFER_TYPE = 'default';
    base.ACTIVE_OFFER = null;
    base.DISCOUNT_BADGE = 'N/A';
    if (base.RATE_PLAN === 'annual pay monthly') {
      base.PAYMENT_PLAN_LABEL = 'Annual - Pay Monthly';
    } else if (base.RATE_PLAN === 'annual pay upfront') {
      base.PAYMENT_PLAN_LABEL = 'Annual - Pay Upfront';
    } else if (base.RATE_PLAN === 'monthly') {
      base.PAYMENT_PLAN_LABEL = 'Flex – Pay Monthly';
    }
  }

  // Flatten ultimate offer template variables for backward compatibility
  base['ULTIMATE_OFFER.enabled'] = String(activeOffer && activeOffer.name === 'ultimate_offer');
  base['ULTIMATE_OFFER.OFFER_PRICE'] = activeOffer && activeOffer.name === 'ultimate_offer' ? activeOffer.OFFER_PRICE : '';
  base['ULTIMATE_OFFER.ORIGINAL_PRICE'] = activeOffer && activeOffer.name === 'ultimate_offer' ? activeOffer.ORIGINAL_PRICE : '';
  base['ULTIMATE_OFFER.DISCOUNT_BADGE'] = activeOffer && activeOffer.name === 'ultimate_offer' ? activeOffer.DISCOUNT_BADGE : '';
  base['ULTIMATE_OFFER.PLAN_LABEL'] = activeOffer && activeOffer.name === 'ultimate_offer' ? activeOffer.PLAN_LABEL : '';
  base['ULTIMATE_OFFER.OFFER_DESCRIPTION'] = activeOffer && activeOffer.name === 'ultimate_offer' ? activeOffer.OFFER_DESCRIPTION : '';
  base['ULTIMATE_OFFER.CANCELLATION_TEXT'] = activeOffer && activeOffer.name === 'ultimate_offer' ? activeOffer.CANCELLATION_TEXT : '';
  // ──────────────────────────────────────────────────────────

  if (regional.DAZN_TIER           ?? merged.DAZN_TIER)           base.DAZN_TIER           = regional.DAZN_TIER           ?? merged.DAZN_TIER;

  // Resolve userState values from central userstatus.json file
  const userStateKey = process.env.USER_STATE || 'freemium';
  const userStatesPath = path.resolve(process.cwd(), 'config/userstatus.json');
  let userStates: Record<string, any> = {};
  if (fs.existsSync(userStatesPath)) {
    userStates = JSON.parse(fs.readFileSync(userStatesPath, 'utf-8'));
  }
  const userStateConfig = userStates[userStateKey] || {};
  base.USER_STATE = userStateKey;

  // Apply general user state configuration
  for (const key of Object.keys(userStateConfig)) {
    if (key !== 'regions') {
      base[key] = userStateConfig[key];
    }
  }

  // Apply regional overrides from user state config
  let userStateRegional = userStateConfig.regions?.[region];
  if (!userStateRegional) {
    // Backward-compat: if region is GB but config only has UK
    if (region === 'GB') {
      userStateRegional = userStateConfig.regions?.UK;
    }
  }
  if (userStateRegional) {
    const envKey = (process.env.DAZN_ENV || 'stag').toLowerCase();
    const envOverrides = userStateRegional.environments?.[envKey];
    const finalRegional = envOverrides 
      ? { ...userStateRegional, ...envOverrides }
      : userStateRegional;

    for (const key of Object.keys(finalRegional)) {
      if (key !== 'environments') {
        base[key] = finalRegional[key];
      }
    }
  }

  // Ultimate entitlement logic: active_ultimate on included PPVs is Purchased, otherwise Buy now.
  let ppvStatus = base.PPV_STATUS || "Buy now";
  if (userStateKey === 'active_ultimate') {
    const ppvType = merged.PPV_TYPE || json.PPV_TYPE;
    if (ppvType === 'included') {
      ppvStatus = 'Purchased';
    } else {
      ppvStatus = 'Buy now';
    }
  }
  base.PPV_STATUS = ppvStatus;

  // Active standard user: Choose How To Buy page shows different feature text
  if (userStateKey === 'active_standard') {
    base.UPSELL_FEATURE_1 = 'Pay-per-views included at no extra cost. Minimum of 12 events per year.';
    base.UPSELL_FEATURE_2 = "185+ fights a year from the best promoters.|185+ fights a year from the best promotors.|185+ fights a year from the world's best promoters.";
    base.UPSELL_FEATURE_3 = "HDR and Dolby 5.1 surround sound on select events.";
  }

  if (!base.RATE_PLAN_LABEL && (regional.RATE_PLAN_LABEL ?? merged.RATE_PLAN_LABEL)) base.RATE_PLAN_LABEL = regional.RATE_PLAN_LABEL ?? merged.RATE_PLAN_LABEL;
  if (!base.USER_EMAIL && (regional.USER_EMAIL ?? merged.USER_EMAIL)) base.USER_EMAIL = regional.USER_EMAIL ?? merged.USER_EMAIL;
  if (!base.USER_PASSWORD && (regional.USER_PASSWORD ?? merged.USER_PASSWORD)) base.USER_PASSWORD = regional.USER_PASSWORD ?? merged.USER_PASSWORD;
  if (!base.PURCHASE_OPTION && (regional.PURCHASE_OPTION ?? merged.PURCHASE_OPTION)) base.PURCHASE_OPTION = regional.PURCHASE_OPTION ?? merged.PURCHASE_OPTION;

  if (!base.RATE_PLAN_LABEL) {
    const rp = base.RATE_PLAN.toLowerCase();
    if (rp === 'monthly') {
      base.RATE_PLAN_LABEL = base.PAYMENT_PLAN_NAME_FLEX || base.FLEX_TITLE || 'Flex – Pay Monthly';
    } else if (rp === 'annual pay monthly') {
      base.RATE_PLAN_LABEL = base.PAYMENT_PLAN_NAME_ANNUAL || base.ANNUAL_TITLE || 'Annual - Pay Monthly';
    } else if (rp === 'annual pay upfront') {
      base.RATE_PLAN_LABEL = 'Annual - Pay Upfront';
    }
  }
  if (merged.FLOW_FROM_POPUP !== undefined) {
    base.FLOW_FROM_POPUP = String(merged.FLOW_FROM_POPUP);
  }

  const planPage = regional.pages?.plan ?? merged.pages?.plan ?? {};
  if (planPage.PAGE_TITLE) base.PLAN_PAGE_TITLE = planPage.PAGE_TITLE;
  if (planPage.CTA_BUTTON) base.PLAN_CTA_BUTTON = planPage.CTA_BUTTON;
  if (planPage.SELECTED_PLAN) base.PLAN_SELECTED = planPage.SELECTED_PLAN;

  const directFields = [
    'PPV_CTA_TEXT',
    'PLAN_PAGE_TITLE',
    'PLAN_CTA_BUTTON',
    'ANNUAL_PAY_MONTHLY_CONTRACT_TEXT',
    'ULTIMATE_FEATURE_2',
    'ULTIMATE_FEATURE_3',
    'SPORT',
    'PPV_LOCATION',
    'BUNDLE_NAME',
    'BUNDLE_DESCRIPTION',
    'BUNDLE_ORIGINAL_PRICE',
    'BUNDLE_PRICE',
    'BUNDLE_SAVE_BADGE',
    'BUNDLE_DISCOUNT',
    'BUNDLE_FIGHT_COUNT',
    'BUNDLE_SECTION_TITLE',
    'BUNDLE_SECTION_SUBTITLE',
    'BUNDLE_PPV_CARD_DESCRIPTION',
    'BUNDLE_PPV1_NAME',
    'BUNDLE_PPV1_FULL_NAME',
    'BUNDLE_PPV1_DATE',
    'BUNDLE_PPV1_LANDING_DATE',
    'BUNDLE_PPV2_NAME',
    'BUNDLE_PPV2_FULL_NAME',
    'BUNDLE_PPV2_DATE',
    'BUNDLE_PPV2_LANDING_DATE',
    'BUNDLE_TODAY_YOU_PAY_STANDARD',
    'OFFER_BADGE',
    'OFFER_DESCRIPTION',
    'UPSELL_CROSSED_PRICE',
    'BUNDLE_MONTHLY_PRICE',
  ];
  for (const field of directFields) {
    const val = regional[field] ?? merged.global?.[field] ?? merged[field];
    if (val !== undefined) base[field] = val;
  }

  // Active standard user: CTA must be set AFTER directFields to avoid being clobbered
  if (userStateKey === 'active_standard') {
    base.PPV_CTA_TEXT = `Continue with ${base.PPV_NAME} only|Continue with pay-per-view`;
  }

  const isUSRegion = (base.BASE_URL || '').includes('/en-US');
  const ratePlanLower = base.RATE_PLAN.toLowerCase();

  if (ratePlanLower === 'annual pay upfront') {
    base.NEXT_PAYMENT_DATE = isUSRegion
      ? formatNextPaymentDateYearlyUS()
      : formatNextPaymentDateYearly();
    base.RENEWAL_DATE = isUSRegion
      ? formatNextPaymentDateYearlyUS()
      : formatNextPaymentDateYearly();
  } else if (ratePlanLower === 'annual pay monthly') {
    base.NEXT_PAYMENT_DATE = isUSRegion
      ? formatNextPaymentDateMonthlyUS()
      : formatNextPaymentDateMonthly();
    base.RENEWAL_DATE = isUSRegion
      ? formatNextPaymentDateYearlyUS()
      : formatNextPaymentDateYearly();
  } else if (merged.NEXT_PAYMENT_DAYS_OFFSET !== undefined) {
    base.NEXT_PAYMENT_DATE = isUSRegion
      ? formatNextPaymentDateUS(Number(merged.NEXT_PAYMENT_DAYS_OFFSET))
      : formatNextPaymentDate(Number(merged.NEXT_PAYMENT_DAYS_OFFSET));
    base.RENEWAL_DATE = isUSRegion
      ? formatNextPaymentDateYearlyUS()
      : formatNextPaymentDateYearly();
  } else {
    base.NEXT_PAYMENT_DATE = isUSRegion
      ? formatNextPaymentDateMonthlyUS()
      : formatNextPaymentDateMonthly();
    base.RENEWAL_DATE = isUSRegion
      ? formatNextPaymentDateYearlyUS()
      : formatNextPaymentDateYearly();
  }

  if (base.ANNUAL_PAY_MONTHLY_PRICE && base.ANNUAL_UPFRONT_PRICE) {
    const monthly = parseFloat(base.ANNUAL_PAY_MONTHLY_PRICE.replace(/[^0-9.]/g, ''));
    const upfront = parseFloat(base.ANNUAL_UPFRONT_PRICE.replace(/[^0-9.]/g, ''));
    if (!isNaN(monthly) && !isNaN(upfront)) {
      const saved = monthly * 12 - upfront;
      base.UPFRONT_SAVE_AMOUNT = saved % 1 === 0 ? saved.toFixed(0) : saved.toFixed(2);
    }
  }

  if (!base.ANNUAL_TOTAL && base.ANNUAL_PRICE) {
    const annualPriceNum = parseFloat(base.ANNUAL_PRICE.replace(/[^0-9.]/g, ''));
    if (!isNaN(annualPriceNum)) {
      const total = annualPriceNum * 11;
      base.ANNUAL_TOTAL = total % 1 === 0 ? total.toFixed(0) : total.toFixed(2);
    }
  }

  const offerType = (base.OFFER_TYPE || '1_month_free').toLowerCase();
  if (offerType === '7_day_trial') {
    base.FLEX_FUTURE_DATE = formatFlexFutureDate(7);
  } else {
    const futureDate = new Date();
    futureDate.setMonth(futureDate.getMonth() + 1);
    const day = futureDate.getDate();
    const month = futureDate.toLocaleString('en-GB', { month: 'long' });
    const year = futureDate.getFullYear();
    base.FLEX_FUTURE_DATE = `In 1 month • ${day} ${month} ${year}`;
  }

  // ── FLATTEN upsell_ppv SECTION ─────────────────────────────────────
  // Cross-PPV references (buy PPV A → success screen promotes PPV B → buy PPV B)
  // Regional overrides take priority — only set if not already present in base
  const upsellPpv = merged.upsell_ppv;
  if (upsellPpv && typeof upsellPpv === 'object') {
    for (const [key, val] of Object.entries(upsellPpv)) {
      if (typeof val === 'string' && !base[key]) {
        base[key] = val;
      }
    }
  }

  if (!base.FIRST_NAME) base.FIRST_NAME = 'UAT';
  if (!base.LAST_NAME)  base.LAST_NAME  = 'UAT';

  if (!base.NEXT_PAYMENT_PRICE) {
    base.NEXT_PAYMENT_PRICE = base.CURRENCY
      ? `${base.CURRENCY}${base.MONTHLY_PRICE}`
      : base.MONTHLY_PRICE;
  }

  // Dynamically resolve UPSELL_PRICE and UPSELL_ORIGINAL_PRICE from ultimate_apm plan + event overrides
  if (!base.UPSELL_PRICE) {
    try {
      const ultimateApmPlan = plans.ultimate_apm;
      const ultimateApmRegion = ultimateApmPlan?.regions?.[region.toUpperCase()] || {};
      const ultimatePlanOffers = ultimateApmRegion.offers || [];
      
      // Merge with event-level overrides
      const combinedUltimateOffers = [...eventRegionalOffers];
      for (const planOffer of ultimatePlanOffers) {
        if (!combinedUltimateOffers.some(o => o.name === planOffer.name)) {
          combinedUltimateOffers.push(planOffer);
        }
      }
      
      const ultimateOffer = combinedUltimateOffers.find(o => o.name === 'ultimate_offer' && o.enabled === true);
      if (ultimateOffer) {
        base.UPSELL_PRICE = getPriceWithCurrency(ultimateOffer.OFFER_PRICE);
        base.UPSELL_ORIGINAL_PRICE = getPriceWithCurrency(ultimateOffer.ORIGINAL_PRICE);
        base.UPSELL_CROSSED_PRICE = getPriceWithCurrency(ultimateOffer.ORIGINAL_PRICE);
        base.UPSELL_OFFER_TEXT = ultimateOffer.OFFER_DESCRIPTION || '';
        console.log(`💡 Resolved dynamic UPSELL_PRICE from ultimate_offer: ${base.UPSELL_PRICE}`);
      } else {
        const standardUltimatePrice = ultimateApmRegion.ANNUAL_PAY_MONTHLY_PRICE || '24.99';
        base.UPSELL_PRICE = getPriceWithCurrency(standardUltimatePrice);
        base.UPSELL_ORIGINAL_PRICE = getPriceWithCurrency(standardUltimatePrice);
        base.UPSELL_CROSSED_PRICE = 'N/A';
        base.UPSELL_OFFER_TEXT = '';
        console.log(`💡 Resolved fallback UPSELL_PRICE: ${base.UPSELL_PRICE}`);
      }
    } catch (e: any) {
      console.warn('⚠️ Failed to resolve UPSELL_PRICE: ', e.message);
    }
  }

  const upsellPrice = base.UPSELL_PRICE || '';
  const ppvPrice = base.PPV_PRICE || '';
  const offerAvailable = base.OFFER_AVAILABLE === 'true';
  const basePriceNum = parseFloat(ppvPrice.replace(/[^0-9.]/g, ''));
  const upsellPriceNum = upsellPrice ? parseFloat(upsellPrice.replace(/[^0-9.]/g, '')) : NaN;

  base.OFFER_AVAILABLE = String(offerAvailable);
  base.OFFER_EFFECTIVE_PPV_PRICE = upsellPrice && offerAvailable ? upsellPrice : ppvPrice;
  base.OFFER_ORIGINAL_PPV_PRICE = ppvPrice;
  base.OFFER_DISCOUNT_AMOUNT = offerAvailable && basePriceNum > parseFloat(upsellPrice.replace(/[^0-9.]/g, ''))
    ? String(Math.round(basePriceNum - parseFloat(upsellPrice.replace(/[^0-9.]/g, ''))))
    : '0';
  base.OFFER_BADGE = base.OFFER_BADGE || '';
  base.OFFER_DESCRIPTION = base.OFFER_DESCRIPTION || '';

  if (offerAvailable && base.OFFER_EFFECTIVE_PPV_PRICE) {
    base.TODAY_YOU_PAY_PRICE = base.OFFER_EFFECTIVE_PPV_PRICE;
  }

  if (base.PPV_PRICE && !base.PPV_PRICE.startsWith(base.CURRENCY)) {
    base.PPV_PRICE_DISPLAY = `${base.CURRENCY}${base.PPV_PRICE}`;
  } else {
    base.PPV_PRICE_DISPLAY = base.PPV_PRICE;
  }

  if (base.UPSELL_PRICE && !base.UPSELL_PRICE.startsWith(base.CURRENCY)) {
    base.UPSELL_PRICE_DISPLAY = `${base.CURRENCY}${base.UPSELL_PRICE}`;
  } else {
    base.UPSELL_PRICE_DISPLAY = base.UPSELL_PRICE;
  }

  base.UPSELL_SUB_TEXT = `Then ${base.CURRENCY}${base.ANNUAL_PRICE} /month for ${base.ANNUAL_MONTHS} months.`;
  base.TRIAL_MONTHLY_TEXT = `${base.CURRENCY}${base.MONTHLY_PRICE}`;

  if (base.ANNUAL_PAY_MONTHLY_PRICE) {
    if (!base.ANNUAL_PAY_MONTHLY_PRICE.startsWith(base.CURRENCY)) {
      base.ANNUAL_PAY_MONTHLY_PRICE_DISPLAY = `${base.CURRENCY}${base.ANNUAL_PAY_MONTHLY_PRICE}`;
    } else {
      base.ANNUAL_PAY_MONTHLY_PRICE_DISPLAY = base.ANNUAL_PAY_MONTHLY_PRICE;
    }
  }

  if (base.ANNUAL_UPFRONT_PRICE) {
    if (!base.ANNUAL_UPFRONT_PRICE.startsWith(base.CURRENCY)) {
      base.ANNUAL_UPFRONT_PRICE_DISPLAY = `${base.CURRENCY}${base.ANNUAL_UPFRONT_PRICE}`;
    } else {
      base.ANNUAL_UPFRONT_PRICE_DISPLAY = base.ANNUAL_UPFRONT_PRICE;
    }
  }

  if (base.UPFRONT_SAVE_AMOUNT) {
    const savedVal = parseFloat(base.UPFRONT_SAVE_AMOUNT);
    if (!isNaN(savedVal) && savedVal <= 0) {
      base.UPFRONT_SAVE_AMOUNT_DISPLAY = 'N/A';
    } else if (!base.UPFRONT_SAVE_AMOUNT.startsWith(base.CURRENCY)) {
      base.UPFRONT_SAVE_AMOUNT_DISPLAY = `${base.CURRENCY}${base.UPFRONT_SAVE_AMOUNT}`;
    } else {
      base.UPFRONT_SAVE_AMOUNT_DISPLAY = base.UPFRONT_SAVE_AMOUNT;
    }
  }

  if (base.UPSELL_FEATURE_1) {
    base.UPSELL_FEATURE_1 = base.UPSELL_FEATURE_1.replace(
      /\{\{PPV_NAME\}\}/g,
      base.PPV_NAME
    );
  } else {
    base.UPSELL_FEATURE_1 =
      `Pay-per-views included at no extra cost. Minimum of 12 events per year including ${base.PPV_NAME}.`;
  }

  if (base.ANNUAL_TOTAL) {
    if (!base.ANNUAL_TOTAL.startsWith(base.CURRENCY)) {
      base.ANNUAL_TOTAL_DISPLAY = `${base.CURRENCY}${base.ANNUAL_TOTAL}`;
    } else {
      base.ANNUAL_TOTAL_DISPLAY = base.ANNUAL_TOTAL;
    }
  }

  if (isBundleFlow && base.TIER !== 'ultimate') {
    base.TODAY_YOU_PAY_PRICE = base.BUNDLE_TODAY_YOU_PAY_STANDARD || base.BUNDLE_PRICE || base.TODAY_YOU_PAY_PRICE;
  }

  if (!base.BUNDLE_MONTHLY_PRICE || base.BUNDLE_MONTHLY_PRICE === 'N/A') {
    if (base.BUNDLE_PRICE && base.BUNDLE_PRICE !== 'N/A') {
      base.BUNDLE_MONTHLY_PRICE = base.BUNDLE_PRICE;
    }
  }

  const keys = Object.keys(base);
  for (const k of keys) {
    const upper = k.toUpperCase();
    if (!(upper in base)) base[upper] = base[k];
  }

  console.log('📦 eventData built:', JSON.stringify(base, null, 2));
  return base;
}
