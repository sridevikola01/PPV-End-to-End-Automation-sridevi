import * as XLSX from 'xlsx';
import * as path from 'path';
import * as fs from 'fs';

const outputPath = path.resolve(process.cwd(), 'data', 'PPV_Input.xlsx');

// ═══════════════════════════════════════════════════════════
// SHEET 1: Landing page
// ═══════════════════════════════════════════════════════════
const landingData = [
  { Field: 'Don\'t Miss Live on DAZN Section', Expected: 'Yes', Flow: 'landing' },
  { Field: 'PPV Tile Present', Expected: 'Yes', Flow: 'landing' },
  { Field: 'PPV Name', Expected: '{{PPV_NAME}}', Flow: 'landing' },
  { Field: 'PPV Date and time', Expected: '{{PPV_DATE}}', Flow: 'landing' },
  { Field: 'Buy Now Button', Expected: 'Yes', Flow: 'landing' },
];

const boxingLandingData = [
  { Field: 'Boxing Banner Present', Expected: 'Yes', Flow: 'boxing' },
  { Field: 'Event Name', Expected: '{{PPV_NAME}}', Flow: 'boxing' },
  { Field: 'Event Subtitle', Expected: 'Main Event  AO Arena, Manchester  11:30 pm.', Flow: 'boxing' },
  { Field: 'Saturday Badge', Expected: 'SATURDAY', Flow: 'boxing' },
  { Field: 'Or Separator', Expected: 'or', Flow: 'boxing' },
  { Field: 'Buy Fight CTA', Expected: 'Buy this fight for {{PPV_PRICE}}', Flow: 'boxing' },
  { Field: 'Get Included CTA', Expected: 'Get included in DAZN Ultimate', Flow: 'boxing' },
  { Field: 'Best Value Badge', Expected: 'Best value for boxing fans', Flow: 'boxing' },
  { Field: 'Upcoming Big Fights Heading', Expected: 'Upcoming Big Fights', Flow: 'boxing-upcoming' },
  { Field: 'PPV Name', Expected: '{{PPV_NAME}}', Flow: 'boxing-upcoming' },
  { Field: 'PPV Date and Time Text', Expected: '{{PPV_DATE}}', Flow: 'boxing-upcoming' },
  { Field: 'PPV Description Text', Expected: '{{PPV_LOCATION}}', Flow: 'boxing-upcoming' },
  { Field: 'PPV Image Present', Expected: 'Yes', Flow: 'boxing-upcoming' },
  { Field: 'Buy Now CTA', Expected: 'Buy now', Flow: 'boxing-upcoming' },
  // ── Bundle section on /boxing page ───────────────────────
  { Field: 'Bundle Section Present', Expected: 'Yes', Flow: 'boxing-bundle' },
  { Field: 'Bundle Section Title', Expected: '{{BUNDLE_SECTION_TITLE}}', Flow: 'boxing-bundle' },
  { Field: 'Bundle Section Subtitle', Expected: '{{BUNDLE_SECTION_SUBTITLE}}', Flow: 'boxing-bundle' },
  { Field: 'Bundle Title', Expected: '{{BUNDLE_NAME}}', Flow: 'boxing-bundle' },
  { Field: 'Bundle Description', Expected: '{{BUNDLE_DESCRIPTION}}', Flow: 'boxing-bundle' },
  { Field: 'Bundle Price', Expected: '{{BUNDLE_PRICE}}', Flow: 'boxing-bundle' },
  { Field: 'Bundle Original Price', Expected: '{{BUNDLE_ORIGINAL_PRICE}}', Flow: 'boxing-bundle' },
  { Field: 'Bundle Save Badge', Expected: '{{BUNDLE_SAVE_BADGE}}', Flow: 'boxing-bundle' },
  { Field: 'Bundle Fight Count', Expected: '{{BUNDLE_FIGHT_COUNT}}', Flow: 'boxing-bundle' },
  { Field: 'Bundle PPV 1 Name', Expected: '{{BUNDLE_PPV1_NAME}}', Flow: 'boxing-bundle' },
  { Field: 'Bundle PPV 1 Date', Expected: '{{BUNDLE_PPV1_LANDING_DATE}}', Flow: 'boxing-bundle' },
  { Field: 'Bundle PPV 1 Image', Expected: 'Yes', Flow: 'boxing-bundle' },
  { Field: 'Bundle PPV 2 Name', Expected: '{{BUNDLE_PPV2_NAME}}', Flow: 'boxing-bundle' },
  { Field: 'Bundle PPV 2 Date', Expected: '{{BUNDLE_PPV2_LANDING_DATE}}', Flow: 'boxing-bundle' },
  { Field: 'Bundle PPV 2 Image', Expected: 'Yes', Flow: 'boxing-bundle' },
  { Field: 'Get Started CTA', Expected: 'Get Started', Flow: 'boxing-bundle' },
  // ── Bundle PPV page validations ─────────────────────────
  { Field: 'Page Title', Expected: 'Choose the right plan for you.', Flow: 'boxing-bundle-ppv' },
  { Field: 'Header Sub Text', Expected: 'To watch your pay-per-view, you\'ll need a DAZN plan.', Flow: 'boxing-bundle-ppv' },
  { Field: 'Bundle Card Title', Expected: '{{BUNDLE_NAME}}', Flow: 'boxing-bundle-ppv' },
  { Field: 'Bundle Card Description', Expected: '{{BUNDLE_PPV_CARD_DESCRIPTION}}', Flow: 'boxing-bundle-ppv' },
  { Field: 'Bundle Card Selected', Expected: 'Yes', Flow: 'boxing-bundle-ppv' },
  { Field: 'Bundle Card Price', Expected: '{{BUNDLE_PRICE}}', Flow: 'boxing-bundle-ppv' },
  { Field: 'Bundle Card Original Price', Expected: '{{BUNDLE_ORIGINAL_PRICE}}', Flow: 'boxing-bundle-ppv' },
  { Field: 'Bundle Card Save Badge', Expected: '{{BUNDLE_SAVE_BADGE}}', Flow: 'boxing-bundle-ppv' },
  { Field: 'Bundle PPV 1 Full Name', Expected: '{{BUNDLE_PPV1_FULL_NAME}}', Flow: 'boxing-bundle-ppv' },
  { Field: 'Bundle PPV 1 PPV Date', Expected: '{{BUNDLE_PPV1_DATE}}', Flow: 'boxing-bundle-ppv' },
  { Field: 'Bundle PPV 1 PPV Image', Expected: 'Yes', Flow: 'boxing-bundle-ppv' },
  { Field: 'Bundle PPV 2 Full Name', Expected: '{{BUNDLE_PPV2_FULL_NAME}}', Flow: 'boxing-bundle-ppv' },
  { Field: 'Bundle PPV 2 PPV Date', Expected: '{{BUNDLE_PPV2_DATE}}', Flow: 'boxing-bundle-ppv' },
  { Field: 'Bundle PPV 2 PPV Image', Expected: 'Yes', Flow: 'boxing-bundle-ppv' },
  { Field: 'Upsell Section Present', Expected: 'Yes', Flow: 'boxing-bundle-ppv' },
  { Field: 'Upsell Badge', Expected: 'The Ultimate Fan Package', Flow: 'boxing-bundle-ppv' },
  { Field: 'Upsell Plan Name', Expected: 'DAZN Ultimate', Flow: 'boxing-bundle-ppv' },
  { Field: 'Upsell Price', Expected: '{{ANNUAL_PAY_MONTHLY_PRICE}}/month', Flow: 'boxing-bundle-ppv' },
  { Field: 'Upsell Contract Text', Expected: 'Annual contract. Auto renews.', Flow: 'boxing-bundle-ppv' },
  { Field: 'Fights Included Text', Expected: 'All these fights included and more.', Flow: 'boxing-bundle-ppv' },
  { Field: 'Upsell Feature 1', Expected: 'Minimum 12 pay-per-views a year included at no extra cost.', Flow: 'boxing-bundle-ppv' },
  { Field: 'Upsell Feature 2', Expected: '185+ fights a year from the world\'s best promoters.', Flow: 'boxing-bundle-ppv' },
  { Field: 'Upsell Feature 3', Expected: 'HDR and Dolby 5.1 surround sound on select events', Flow: 'boxing-bundle-ppv' },
  { Field: 'CTA Button', Expected: 'Continue with DAZN Ultimate', Flow: 'boxing-bundle-ppv' },
];

// ═══════════════════════════════════════════════════════════
// SHEET 2: PPV page
// ═══════════════════════════════════════════════════════════
const ppvData = [
  // ── variant1 ─────────────────────────────────────────────

  { Variant: 'variant1', Field: 'Page Title', Expected: 'Choose the right plan for you.', Flow: '' },
  { Variant: 'variant1', Field: 'Header Sub Text', Expected: 'To watch your pay-per-view, you\'ll need a DAZN plan.', Flow: '' },
  { Variant: 'variant1', Field: 'Header Highlight Text1', Expected: '{{PPV_NAME}}', Flow: '' },
  { Variant: 'variant1', Field: 'Header Highlight Text2', Expected: 'N/A', Flow: '' },
  { Variant: 'variant1', Field: 'Hero Image', Expected: 'Yes', Flow: '' },
  { Variant: 'variant1', Field: 'Event Name', Expected: '{{PPV_NAME}}', Flow: '' },
  { Variant: 'variant1', Field: 'PPV Price', Expected: '{{PPV_PRICE}}', Flow: '' },
  { Variant: 'variant1', Field: 'Currency', Expected: '{{CURRENCY}}', Flow: '' },
  { Variant: 'variant1', Field: 'DAZN Tier', Expected: '+DAZN Standard', Flow: 'newuser' },
  { Variant: 'variant1', Field: 'PPV Name', Expected: '{{PPV_NAME}}', Flow: '' },
  { Variant: 'variant1', Field: 'PPV Image Present', Expected: 'Yes', Flow: '' },
  { Variant: 'variant1', Field: 'PPV Date and Time Text', Expected: '{{PPV_DATE}}', Flow: '' },
  { Variant: 'variant1', Field: 'Radio Selected', Expected: 'Yes', Flow: '' },
  { Variant: 'variant1', Field: 'PPV Card Title', Expected: 'PPV: {{PPV_NAME}}', Flow: '' },
  { Variant: 'variant1', Field: 'PPV Card Description', Expected: '{{PPV_CARD_DESCRIPTION}}', Flow: '' },
  { Variant: 'variant1', Field: 'Upsell Section Present', Expected: 'Yes', Flow: '' },
  { Variant: 'variant1', Field: 'Upsell Badge', Expected: 'The Ultimate Fan Package', Flow: '' },
  { Variant: 'variant1', Field: 'Upsell Plan Name', Expected: 'DAZN Ultimate', Flow: '' },
  { Variant: 'variant1', Field: 'Upsell Price Text', Expected: 'N/A', Flow: '' },
  { Variant: 'variant1', Field: 'Upsell Price', Expected: '{{UPSELL_PRICE}}', Flow: '' },
  { Variant: 'variant1', Field: 'Upsell Price Length', Expected: '/month', Flow: '' },
  { Variant: 'variant1', Field: 'Upsell Billing Text', Expected: 'N/A', Flow: '' },
  { Variant: 'variant1', Field: 'Upsell Offer Text', Expected: '{{UPSELL_OFFER_TEXT}}', Flow: '' },
  { Variant: 'variant1', Field: 'Upsell Section Heading', Expected: '{{UPSELL_SECTION_HEADING}}', Flow: '' },
  { Variant: 'variant1', Field: 'Included PPV1 Name', Expected: '{{PPV_NAME}}', Flow: '' },
  { Variant: 'variant1', Field: 'PPV1 Image Present on ultimate tier', Expected: 'Yes', Flow: '' },
  { Variant: 'variant1', Field: 'PPV1 Date Text on ultimate tier', Expected: '{{PPV_DATE}}', Flow: '' },
  { Variant: 'variant1', Field: 'PPV1 Included tag', Expected: 'N/A', Flow: '' },
  { Variant: 'variant1', Field: 'Included PPV2 Name', Expected: 'N/A', Flow: '' },
  { Variant: 'variant1', Field: 'PPV2 Image Present on ultimate tier', Expected: 'N/A', Flow: '' },
  { Variant: 'variant1', Field: 'PPV2 Date Text on ultimate tier', Expected: 'N/A', Flow: '' },
  { Variant: 'variant1', Field: 'PPV2 Included tag', Expected: 'N/A', Flow: '' },
  { Variant: 'variant1', Field: 'Upsell Feature 1', Expected: '{{UPSELL_FEATURE_1}}', Flow: '' },
  { Variant: 'variant1', Field: 'Upsell Highlight Text', Expected: 'N/A', Flow: '' },
  { Variant: 'variant1', Field: 'Upsell Feature 2', Expected: '{{UPSELL_FEATURE_2}}', Flow: '' },
  { Variant: 'variant1', Field: 'Upsell Feature 3', Expected: '{{UPSELL_FEATURE_3}}', Flow: '' },
  { Variant: 'variant1', Field: 'Whats Included CTA', Expected: 'N/A', Flow: '' },
  { Variant: 'variant1', Field: 'Gold Highlight 1', Expected: 'N/A', Flow: '' },
  { Variant: 'variant1', Field: 'Gold Highlight 2', Expected: 'N/A', Flow: '' },
  { Variant: 'variant1', Field: 'Gold Highlight 3', Expected: 'N/A', Flow: '' },
  { Variant: 'variant1', Field: 'CTA Button', Expected: '{{PPV_CTA_TEXT}}', Flow: '' },
  { Variant: 'variant1', Field: 'CTA Without PPV', Expected: 'Subscribe without a pay-per-view', Flow: 'newuser' },

  // ── variant2 ─────────────────────────────────────────────

  { Variant: 'variant2', Field: 'Page Title', Expected: 'Choose your plan', Flow: '' },
  { Variant: 'variant2', Field: 'Header Full Copy', Expected: 'Buy {{PPV_NAME}} with DAZN Standard or get it included in DAZN Ultimate.', Flow: '' },
  { Variant: 'variant2', Field: 'Header Highlight Text1', Expected: '{{PPV_NAME}}', Flow: '' },
  { Variant: 'variant2', Field: 'Header Highlight Text2', Expected: 'get it included in DAZN Ultimate.', Flow: '' },
  { Variant: 'variant2', Field: 'PPV Image', Expected: 'Yes', Flow: '' },
  { Variant: 'variant2', Field: 'Event Date and Time', Expected: '{{PPV_DATE}}', Flow: '' },
  { Variant: 'variant2', Field: 'Event Name', Expected: '{{PPV_NAME}}', Flow: '' },
  { Variant: 'variant2', Field: 'PPV Checkbox Present', Expected: 'Yes', Flow: '' },
  { Variant: 'variant2', Field: 'PPV Selected', Expected: 'Yes', Flow: '' },
  { Variant: 'variant2', Field: 'PPV Name', Expected: '{{PPV_NAME}}', Flow: '' },
  { Variant: 'variant2', Field: 'PPV Price', Expected: '{{PPV_PRICE}}', Flow: '' },
  { Variant: 'variant2', Field: 'Currency', Expected: '{{CURRENCY}}', Flow: '' },
  { Variant: 'variant2', Field: 'Subscription Section Title', Expected: 'Choose your subscription', Flow: '' },
  { Variant: 'variant2', Field: 'Trial Card Present', Expected: 'Yes', Flow: '' },
  { Variant: 'variant2', Field: 'Trial Title', Expected: '7-day free trial of DAZN Standard', Flow: '' },
  { Variant: 'variant2', Field: 'Trial Radio Present', Expected: 'Yes', Flow: '' },
  { Variant: 'variant2', Field: 'Trial Selected', Expected: 'Yes', Flow: '' },
  { Variant: 'variant2', Field: 'Trial Feature 1', Expected: '7-days free access to DAZN Standard.', Flow: '' },
  { Variant: 'variant2', Field: 'Trial Feature 2', Expected: 'Cancel anytime during the trial and only pay for the fight. After the trial you move onto a Monthly Flex plan for {{CURRENCY}}{{MONTHLY_PRICE}}/month. You will not lose access to the pay-per-view[s].', Flow: '' },
  { Variant: 'variant2', Field: 'Upsell Section Present', Expected: 'Yes', Flow: '' },
  { Variant: 'variant2', Field: 'Upsell Label', Expected: 'Pay-per-views included', Flow: '' },
  { Variant: 'variant2', Field: 'Upsell Plan Name', Expected: 'DAZN Ultimate', Flow: '' },
  { Variant: 'variant2', Field: 'Upsell Price Text', Expected: 'From', Flow: '' },
  { Variant: 'variant2', Field: 'Upsell Price', Expected: '{{UPSELL_PRICE}}', Flow: '' },
  { Variant: 'variant2', Field: 'Upsell Price Length', Expected: '/ month', Flow: '' },
  { Variant: 'variant2', Field: 'Upsell Billing Text', Expected: 'Annual contract. Auto renews.', Flow: '' },
  { Variant: 'variant2', Field: 'Included PPV1 Name', Expected: '{{PPV_NAME}}', Flow: '' },
  { Variant: 'variant2', Field: 'PPV1 Image Present on ultimate tier', Expected: 'Yes', Flow: '' },
  { Variant: 'variant2', Field: 'PPV1 Date Text on ultimate tier', Expected: '{{PPV_DATE}}', Flow: '' },
  { Variant: 'variant2', Field: 'PPV1 Included tag', Expected: 'Yes', Flow: '' },
  { Variant: 'variant2', Field: 'Included PPV2 Name', Expected: 'N/A', Flow: '' },
  { Variant: 'variant2', Field: 'PPV2 Image Present on ultimate tier', Expected: 'N/A', Flow: '' },
  { Variant: 'variant2', Field: 'PPV2 Date Text on ultimate tier', Expected: 'N/A', Flow: '' },
  { Variant: 'variant2', Field: 'PPV2 Included tag', Expected: 'N/A', Flow: '' },
  { Variant: 'variant2', Field: 'Upsell Feature 1', Expected: 'Pay-per-views included at no extra cost. Minimum of 12 events per year including {{PPV_NAME}}.', Flow: '' },
  { Variant: 'variant2', Field: 'Upsell Highlight Text', Expected: '{{PPV_NAME}}.', Flow: '' },
  { Variant: 'variant2', Field: 'Upsell Feature 2', Expected: 'HDR and Dolby 5.1 surround sound on select events.', Flow: '' },
  { Variant: 'variant2', Field: 'Upsell Feature 3', Expected: '185+ fights a year from the best promoters', Flow: '' },
  { Variant: 'variant2', Field: 'Whats Included CTA', Expected: 'Whats included', Flow: '' },
  { Variant: 'variant2', Field: 'Gold Highlight 1', Expected: '{{PPV_NAME}}', Flow: '' },
  { Variant: 'variant2', Field: 'Gold Highlight 2', Expected: 'get it included in DAZN Ultimate.', Flow: '' },
  { Variant: 'variant2', Field: 'Gold Highlight 3', Expected: 'DAZN Ultimate', Flow: '' },
  { Variant: 'variant2', Field: 'CTA Button', Expected: 'Continue with PPV + 7-day free trial', Flow: '' },
  { Variant: 'variant2', Field: 'CTA Without PPV', Expected: 'N/A', Flow: '' },
];

// ═══════════════════════════════════════════════════════════
// SHEET 3: Dazn Plan page
// Supports both "7 day trial" and "1 month free" offer types
// ═══════════════════════════════════════════════════════════
const planData = [
  // ── Standard ─────────────────────────────────────────────

  { Tier: 'Standard', Field: 'Page Title', Expected: '{{PLAN_PAGE_TITLE}}', Flow: '' },
  { Tier: 'Standard', Field: 'Flex Card Present', Expected: 'Yes', Flow: '' },
  { Tier: 'Standard', Field: 'Flex Title', Expected: 'Flex – Pay Monthly', Flow: '' },
  { Tier: 'Standard', Field: 'Flex Badge', Expected: '{{FLEX_BADGE}}', Flow: '' },
  { Tier: 'Standard', Field: 'Flex Description', Expected: '{{FLEX_DESCRIPTION}}', Flow: '' },
  { Tier: 'Standard', Field: 'Flex Selected', Expected: 'Yes', Flow: '' },
  { Tier: 'Standard', Field: 'Flex Today Text', Expected: '{{FLEX_TODAY_TEXT}}', Flow: '' },
  { Tier: 'Standard', Field: 'Flex Future Text', Expected: '{{FLEX_FUTURE_TEXT}}', Flow: '' },
  { Tier: 'Standard', Field: 'Annual Card Present', Expected: 'Yes', Flow: '' },
  { Tier: 'Standard', Field: 'Annual Savings Badge', Expected: '{{ANNUAL_SAVINGS_BADGE}}', Flow: '' },
  { Tier: 'Standard', Field: 'Annual Title', Expected: 'Annual - Pay Monthly', Flow: '' },
  { Tier: 'Standard', Field: 'Annual Badge', Expected: '1 MONTH FREE', Flow: '' },
  { Tier: 'Standard', Field: 'Annual Price Text', Expected: 'then {{CURRENCY}}{{ANNUAL_PRICE}}/month for {{ANNUAL_MONTHS}} months', Flow: '' },
  { Tier: 'Standard', Field: 'Annual Contract Text', Expected: 'Annual contract. Auto renews.', Flow: '' },
  { Tier: 'Standard', Field: 'Annual Feature 1', Expected: '185+ fights a year from the world\'s best promoters.', Flow: '' },
  { Tier: 'Standard', Field: 'Annual Feature 2', Expected: 'Additional cost for pay-per-view events.', Flow: '' },
  { Tier: 'Standard', Field: 'Annual Feature 3', Expected: 'Full HD video resolution.', Flow: '' },
  { Tier: 'Standard', Field: 'Annual Selected', Expected: 'No', Flow: '' },
  { Tier: 'Standard', Field: 'CTA Button', Expected: '{{PLAN_CTA_BUTTON}}', Flow: '' },

  // ── Ultimate ─────────────────────────────────────────────

  { Tier: 'Ultimate', Field: 'Page Title', Expected: '{{PLAN_PAGE_TITLE}}', Flow: '' },
  { Tier: 'Ultimate', Field: 'Annual Pay Monthly Option', Expected: 'Yes', Flow: '' },
  { Tier: 'Ultimate', Field: 'Annual Pay Monthly Title', Expected: 'Annual - Pay Monthly', Flow: '' },
  { Tier: 'Ultimate', Field: 'Annual Pay Monthly Price', Expected: '{{ANNUAL_PAY_MONTHLY_PRICE}}', Flow: '' },
  { Tier: 'Ultimate', Field: 'Annual Pay Monthly Price Length', Expected: '/ month', Flow: '' },
  { Tier: 'Ultimate', Field: 'Annual Pay Monthly Contract Text', Expected: '{{ANNUAL_PAY_MONTHLY_CONTRACT_TEXT}}', Flow: '' },
  { Tier: 'Ultimate', Field: 'Annual Pay Monthly Selected', Expected: 'Yes', Flow: '' },
  { Tier: 'Ultimate', Field: 'Annual Pay Upfront Option', Expected: 'Yes', Flow: '' },
  { Tier: 'Ultimate', Field: 'Annual Pay Upfront Title', Expected: 'Annual - Pay Upfront', Flow: '' },
  { Tier: 'Ultimate', Field: 'Annual Pay Upfront Save Badge', Expected: 'Save {{CURRENCY}}{{UPFRONT_SAVE_AMOUNT}}', Flow: '' },
  { Tier: 'Ultimate', Field: 'Annual Pay Upfront Price', Expected: '{{ANNUAL_UPFRONT_PRICE_DISPLAY}}', Flow: '' },
  { Tier: 'Ultimate', Field: 'Annual Pay Upfront Price Length', Expected: '/year', Flow: '' },
  { Tier: 'Ultimate', Field: 'Annual Pay Upfront Selected', Expected: 'No', Flow: '' },
  { Tier: 'Ultimate', Field: 'Ultimate Feature 1', Expected: 'Minimum 12 pay-per-views a year included at no extra cost.', Flow: '' },
  { Tier: 'Ultimate', Field: 'Ultimate Feature 2', Expected: '185+ fights a year from the world\'s best promoters.', Flow: '' },
  { Tier: 'Ultimate', Field: 'Ultimate Feature 3', Expected: 'HDR and Dolby 5.1 surround sound on select events.', Flow: '' },
  { Tier: 'Ultimate', Field: 'CTA Button', Expected: '{{PLAN_CTA_BUTTON}}', Flow: '' },
];

// ═══════════════════════════════════════════════════════════
// SHEET 4: Payment page
// Supports both "7 day trial" and "1 month free" offer types
// ═══════════════════════════════════════════════════════════
const paymentData = [
  // ── Common ───────────────────────────────────────────────
  { Tier: 'Common', 'Rate Plan': 'All', Field: 'Header', Expected: 'Your payment is encrypted and you can change how you pay at any time.', Flow: '' },
  { Tier: 'Common', 'Rate Plan': 'All', Field: 'Plan Change CTA', Expected: 'Change', Flow: '' },
  { Tier: 'Common', 'Rate Plan': 'All', Field: 'Credit & Debit Card Option', Expected: 'Yes', Flow: '' },
  { Tier: 'Common', 'Rate Plan': 'All', Field: 'PayPal Option', Expected: 'Yes', Flow: '' },
  { Tier: 'Common', 'Rate Plan': 'All', Field: 'Google Pay Option', Expected: 'Yes', Flow: '' },
  { Tier: 'Common', 'Rate Plan': 'All', Field: 'Saved Card Present', Expected: 'Yes', Flow: 'myaccount' },
  { Tier: 'Common', 'Rate Plan': 'All', Field: 'Signed In As Text', Expected: 'Signed in as {{FIRST_NAME}} {{LAST_NAME}}', Flow: 'returning' },
  { Tier: 'Common', 'Rate Plan': 'All', Field: 'Log Out Present', Expected: 'Yes', Flow: 'returning' },
  { Tier: 'Common', 'Rate Plan': 'All', Field: 'Redeem Promo Code CTA', Expected: 'Yes', Flow: '' },

  // ── Standard + Monthly ───────────────────────────────────
  { Tier: 'Standard', 'Rate Plan': 'Monthly', Field: 'Page Title', Expected: '{{PAYMENT_PAGE_TITLE}}', Flow: 'newuser' },
  { Tier: 'Standard', 'Rate Plan': 'Monthly', Field: 'Page Title', Expected: '{{PAYMENT_PAGE_TITLE}}', Flow: 'myaccount' },
  { Tier: 'Standard', 'Rate Plan': 'Monthly', Field: 'DAZN Tier', Expected: 'DAZN Standard', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Monthly', Field: 'Plan Name', Expected: '{{PAYMENT_PLAN_NAME}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Monthly', Field: 'First Month Free Price', Expected: '{{CURRENCY}}0', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Monthly', Field: 'First Month Free Text', Expected: '{{PAYMENT_FREE_TEXT}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Monthly', Field: 'PPV Name', Expected: '{{PPV_NAME}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Monthly', Field: 'PPV Price', Expected: '{{PPV_PRICE}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Monthly', Field: 'Today You Pay Text', Expected: 'Today you pay', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Monthly', Field: 'Today You Pay Price', Expected: '{{PPV_PRICE}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Monthly', Field: 'Cancellation Text', Expected: '{{CANCELLATION_TEXT}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Monthly', Field: 'Ultimate Upsell Text', Expected: 'Switch to DAZN Ultimate and enjoy pay-per-views at no extra cost|N/A', Flow: '' },

  // ── Standard + Annual Pay Monthly ────────────────────────
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly', Field: 'Page Title', Expected: 'Choose how to pay', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly', Field: 'DAZN Tier', Expected: 'DAZN Standard', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly', Field: 'PPV Name', Expected: '{{PPV_NAME}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly', Field: 'PPV Price', Expected: '{{PPV_PRICE}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly', Field: 'Rate Plan', Expected: '{{RATE_PLAN_LABEL}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly', Field: 'Rate Plan Original Price', Expected: '{{CURRENCY}}{{ANNUAL_PRICE}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly', Field: 'Rate Plan Discounted Price', Expected: '{{CURRENCY}}0', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly', Field: 'Today You Pay Text', Expected: 'Today you pay', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly', Field: 'Today You Pay Price', Expected: '{{PPV_PRICE}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly', Field: 'Cancellation Text', Expected: '{{CANCELLATION_TEXT_ANNUAL}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly', Field: 'Redeem Promo Code CTA', Expected: 'Yes', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly', Field: 'Ultimate Upsell Text', Expected: 'Switch to DAZN Ultimate and enjoy pay-per-views at no extra cost|N/A', Flow: '' },

  // ── Ultimate + Annual Pay Monthly ────────────────────────
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly', Field: 'Page Title', Expected: 'Choose how to pay', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly', Field: 'DAZN Tier', Expected: 'DAZN Ultimate', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly', Field: 'PPV Name', Expected: '{{PPV_NAME}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly', Field: 'PPV Price', Expected: '{{CURRENCY}}0', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly', Field: 'Rate Plan', Expected: 'Annual - Pay Monthly', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly', Field: 'Rate Plan Price', Expected: '{{ANNUAL_PAY_MONTHLY_PRICE}}/month', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly', Field: 'Today You Pay Text', Expected: 'Today you pay', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly', Field: 'Today You Pay Price', Expected: '{{TODAY_YOU_PAY_PRICE}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly', Field: 'Next Payment Label', Expected: 'Next payment on {{NEXT_PAYMENT_DATE}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly', Field: 'Next Payment Price', Expected: '{{ANNUAL_PAY_MONTHLY_PRICE}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly', Field: 'Cancellation Text', Expected: '{{CANCELLATION_TEXT}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly', Field: 'Redeem Promo Code CTA', Expected: 'Yes', Flow: '' },

  // ── Ultimate + Annual Pay Upfront ────────────────────────
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront', Field: 'Page Title', Expected: 'Choose how to pay', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront', Field: 'DAZN Tier', Expected: 'DAZN Ultimate', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront', Field: 'PPV Name', Expected: '{{PPV_NAME}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront', Field: 'PPV Price', Expected: '{{CURRENCY}}0', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront', Field: 'Rate Plan', Expected: 'Annual - Pay Upfront', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront', Field: 'Rate Plan Price', Expected: '{{ANNUAL_UPFRONT_PRICE}}/year', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront', Field: 'Today You Pay Text', Expected: 'Today you pay', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront', Field: 'Today You Pay Price', Expected: '{{TODAY_YOU_PAY_PRICE}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront', Field: 'Next Payment Label', Expected: 'Next Annual payment on {{NEXT_PAYMENT_DATE}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront', Field: 'Next Payment Price', Expected: '{{ANNUAL_UPFRONT_PRICE}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront', Field: 'Cancellation Text', Expected: '{{CANCELLATION_TEXT}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront', Field: 'Redeem Promo Code CTA', Expected: 'Yes', Flow: '' },

  // ── Standard + Monthly Bundle ────────────────────────────
  { Tier: 'Standard', 'Rate Plan': 'Monthly Bundle', Field: 'Page Title', Expected: '{{PAYMENT_PAGE_TITLE}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Monthly Bundle', Field: 'DAZN Tier', Expected: 'DAZN Standard', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Monthly Bundle', Field: 'Bundle Name', Expected: '{{BUNDLE_NAME}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Monthly Bundle', Field: 'Bundle Price', Expected: '{{BUNDLE_PRICE}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Monthly Bundle', Field: 'Today You Pay Price', Expected: '{{BUNDLE_TODAY_YOU_PAY_STANDARD}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Monthly Bundle', Field: 'Cancellation Text', Expected: '{{CANCELLATION_TEXT}}', Flow: '' },

  // ── Standard + Annual Pay Monthly Bundle ──────────────────
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'Page Title', Expected: 'Choose how to pay', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'DAZN Tier', Expected: 'DAZN Standard', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'Rate Plan', Expected: 'Annual - Pay Monthly', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'First Month Free Text', Expected: 'First month free', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'Bundle Name', Expected: '{{BUNDLE_NAME}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'Bundle Original Price', Expected: '{{BUNDLE_ORIGINAL_PRICE}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'Bundle Price', Expected: '{{BUNDLE_PRICE}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'Bundle Discount', Expected: '{{BUNDLE_DISCOUNT}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'Today You Pay Price', Expected: '{{BUNDLE_TODAY_YOU_PAY_STANDARD}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'Cancellation Text', Expected: '{{CANCELLATION_TEXT_ANNUAL}}', Flow: '' },
  { Tier: 'Standard', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'Ultimate Upsell Text', Expected: 'Switch to DAZN Ultimate and enjoy pay-per-views at no extra cost|N/A', Flow: '' },

  // ── Ultimate + Annual Pay Monthly Bundle ──────────────────
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'Page Title', Expected: 'Choose how to pay', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'DAZN Tier', Expected: 'DAZN Ultimate', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'Rate Plan', Expected: 'Annual - Pay Monthly', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'Rate Plan Price', Expected: '{{ANNUAL_PAY_MONTHLY_PRICE}}/month', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'Bundle Name', Expected: '{{BUNDLE_NAME}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'Bundle Price', Expected: '{{CURRENCY}}0', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'Today You Pay Price', Expected: '{{TODAY_YOU_PAY_PRICE}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'Next Payment Label', Expected: 'Next payment on {{NEXT_PAYMENT_DATE}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'Next Payment Price', Expected: '{{ANNUAL_PAY_MONTHLY_PRICE}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Monthly Bundle', Field: 'Cancellation Text', Expected: '{{CANCELLATION_TEXT}}', Flow: '' },

  // ── Ultimate + Annual Pay Upfront Bundle ──────────────────
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront Bundle', Field: 'Page Title', Expected: 'Choose how to pay', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront Bundle', Field: 'DAZN Tier', Expected: 'DAZN Ultimate', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront Bundle', Field: 'Rate Plan', Expected: 'Annual - Pay Upfront', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront Bundle', Field: 'Rate Plan Price', Expected: '{{ANNUAL_UPFRONT_PRICE}}/year', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront Bundle', Field: 'Save Badge', Expected: 'Save {{CURRENCY}}{{UPFRONT_SAVE_AMOUNT}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront Bundle', Field: 'Bundle Name', Expected: '{{BUNDLE_NAME}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront Bundle', Field: 'Bundle Price', Expected: '{{CURRENCY}}0', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront Bundle', Field: 'Today You Pay Price', Expected: '{{ANNUAL_UPFRONT_PRICE}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront Bundle', Field: 'Next Payment Label', Expected: 'Next Annual payment on {{NEXT_PAYMENT_DATE}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront Bundle', Field: 'Next Payment Price', Expected: '{{ANNUAL_UPFRONT_PRICE}}', Flow: '' },
  { Tier: 'Ultimate', 'Rate Plan': 'Annual Pay Upfront Bundle', Field: 'Cancellation Text', Expected: '{{CANCELLATION_TEXT}}', Flow: '' },
];

// ═══════════════════════════════════════════════════════════
// SHEET 5: Schedule page
// ═══════════════════════════════════════════════════════════
const scheduleData = [
  { Field: 'PPV Tile Present', Expected: 'Yes' },
  { Field: 'PPV Name', Expected: '{{PPV_NAME}}' },
  { Field: 'PPV Date', Expected: '{{PPV_DATE}}' },
  { Field: 'PPV Time on Tile', Expected: '{{PPV_TIME}}' },
  { Field: 'Lock Icon Present', Expected: 'Yes' },
  { Field: 'PPV Promoter on Tile', Expected: '{{PPV_PROMOTER}}' },
  { Field: 'Popup Image Present', Expected: 'Yes' },
  { Field: 'Popup Date', Expected: '{{PPV_DATE}}' },
  { Field: 'Popup PPV Name', Expected: '{{PPV_NAME}}' },
  { Field: 'Popup Promoter', Expected: '{{PPV_PROMOTER}}' },
  { Field: 'Popup Description', Expected: '{{PPV_DESCRIPTION}}' },
  { Field: 'Popup Buy Now CTA', Expected: 'Yes' },
  { Field: 'Popup Close Button', Expected: 'Yes' },
];

// ═══════════════════════════════════════════════════════════
// SHEET 6: My Account page
// ═══════════════════════════════════════════════════════════
const myAccountData = [
  { Field: 'Current Subscription', Expected: '{{DAZN_TIER}}' },
  { Field: 'Subscription Status', Expected: '{{SUBSCRIPTION_STATUS}}' },
  { Field: 'PPV Section Present', Expected: 'Yes' },
  { Field: 'PPV Name', Expected: '{{PPV_NAME}}' },
  { Field: 'PPV Date', Expected: '{{PPV_DATE}}' },
  { Field: 'PPV Price', Expected: '{{PPV_PRICE}}' },
  { Field: 'PPV Status', Expected: '{{PPV_STATUS}}' },
];

// ═══════════════════════════════════════════════════════════
// SHEET 7: Choose How To Buy page
// ═══════════════════════════════════════════════════════════
const chooseHowToBuyData = [
  { Field: 'Page Title', Expected: 'Choose how to buy|Choose your plan' },
  { Field: 'Header PPV Name', Expected: '{{PPV_NAME}}' },
  { Field: 'Header Sub Text', Expected: 'Buy {{PPV_NAME}}, or get it included in a DAZN Ultimate subscription' },
  { Field: 'PPV Option Present', Expected: 'Yes' },
  { Field: 'PPV Option Selected', Expected: 'Yes' },
  { Field: 'PPV Option Price', Expected: '{{PPV_PRICE}}' },
  { Field: 'PPV Image Present', Expected: 'Yes' },
  { Field: 'PPV Date and Time', Expected: '{{PPV_DATE}}' },
  { Field: 'DAZN Ultimate Option Present', Expected: 'Yes' },
  { Field: 'DAZN Ultimate Price Text', Expected: 'From' },
  { Field: 'DAZN Ultimate Price', Expected: '{{UPSELL_PRICE}}' },
  { Field: 'DAZN Ultimate Price Length', Expected: '/ month' },
  { Field: 'DAZN Ultimate Billing Text', Expected: 'Annual contract. Auto renews.' },
  { Field: 'PPV Included Tag', Expected: 'Yes' },
  { Field: 'Upsell Label', Expected: 'N/A' },
  { Field: 'Upsell Plan Name', Expected: 'DAZN Ultimate' },
  { Field: 'Upsell Feature 1', Expected: '{{UPSELL_FEATURE_1}}' },
  { Field: 'Upsell Highlight Text', Expected: 'N/A' },
  { Field: 'Upsell Feature 2', Expected: '{{UPSELL_FEATURE_2}}' },
  { Field: 'Upsell Feature 3', Expected: '{{UPSELL_FEATURE_3}}' },
  { Field: 'Whats Included CTA', Expected: 'Whats included' },
  { Field: 'CTA Button', Expected: '{{PPV_CTA_TEXT}}' },
];

// ═══════════════════════════════════════════════════════════
// SHEET 8: PPV Payment page
// ═══════════════════════════════════════════════════════════
const ppvPaymentData = [
  { Field: 'Skip CTA', Expected: 'Yes' },
  { Field: 'PPV Name', Expected: '{{PPV_NAME}}' },
  { Field: 'PPV Description', Expected: 'Yes' },
  { Field: 'PPV Image Present', Expected: 'Yes' },
  { Field: 'PPV Date and Time', Expected: '{{PPV_DATE}}' },
  { Field: 'Order Summary PPV Name', Expected: '{{PPV_NAME}}' },
  { Field: 'Today You Pay Text', Expected: 'Today you pay' },
  { Field: 'Today You Pay Price', Expected: '{{PPV_PRICE}}' },
  { Field: 'Payment Method Present', Expected: 'Yes' },
  { Field: 'Pay Now Button', Expected: 'Yes' },
  { Field: 'Secure Checkout', Expected: 'Yes' },
  { Field: 'More Payment Methods', Expected: 'Yes' },
  { Field: 'Legal Text Present', Expected: 'Yes' },
  { Field: 'Terms Link Present', Expected: 'Yes' },
  { Field: 'Privacy Policy Link Present', Expected: 'Yes' },
];

// ═══════════════════════════════════════════════════════════
// SHEET 9: Upgrade Confirmation page
// ═══════════════════════════════════════════════════════════
const upgradeConfirmationData = [
  { Tier: 'common', Field: 'Page Title', Expected: 'DAZN Ultimate' },
  { Tier: 'common', Field: 'Page Description', Expected: 'Yes' },
  { Tier: 'common', Field: 'Payment Method Present', Expected: 'Yes' },
  { Tier: 'common', Field: 'Confirm Button', Expected: 'Confirm' },
  { Tier: 'common', Field: 'Terms Link Present', Expected: 'Yes' },
  { Tier: 'common', Field: 'Legal Text Line 1', Expected: 'Your plan will be changed to DAZN Ultimate today' },
  { Tier: 'common', Field: 'Legal Text Line 2', Expected: 'Today you will be charged' },
  { Tier: 'annual pay upfront', Field: 'Rate Plan', Expected: 'Annual - Pay Upfront' },
  { Tier: 'annual pay upfront', Field: 'Rate Plan Price', Expected: '{{ANNUAL_UPFRONT_PRICE}}' },
  { Tier: 'annual pay upfront', Field: 'Rate Plan Period', Expected: '/year' },
  { Tier: 'annual pay upfront', Field: 'Rate Plan Description', Expected: 'Get the best value when you pay upfront.' },
  { Tier: 'annual pay upfront', Field: 'Next Payment Label', Expected: 'Next payment on' },
  { Tier: 'annual pay upfront', Field: 'Next Payment Date', Expected: '{{NEXT_PAYMENT_DATE}}' },
  { Tier: 'annual pay upfront', Field: 'Next Payment Price', Expected: '{{ANNUAL_UPFRONT_PRICE}}' },
  { Tier: 'annual pay monthly', Field: 'Rate Plan', Expected: 'Annual - Pay Monthly' },
  { Tier: 'annual pay monthly', Field: 'Rate Plan Price', Expected: '{{ANNUAL_PAY_MONTHLY_PRICE}}' },
  { Tier: 'annual pay monthly', Field: 'Rate Plan Period', Expected: '/ month' },
  { Tier: 'annual pay monthly', Field: 'Rate Plan Description', Expected: 'Annual contract. Paid in 12 monthly instalments.' },
  { Tier: 'annual pay monthly', Field: 'Next Payment Label', Expected: 'Next payment on' },
  { Tier: 'annual pay monthly', Field: 'Next Payment Date', Expected: '{{NEXT_PAYMENT_DATE}}' },
  { Tier: 'annual pay monthly', Field: 'Next Payment Price', Expected: '{{ANNUAL_PAY_MONTHLY_PRICE}}' },
];

// ═══════════════════════════════════════════════════════════
// SHEET 10: Phone Number page
// ═══════════════════════════════════════════════════════════
const phoneNumberData = [
  { Field: 'Page Title', Expected: 'Add your phone number' },
  { Field: 'Page Description', Expected: 'This helps us recover your account if you ever get locked out.' },
  { Field: 'Phone Input Present', Expected: 'Yes' },
  { Field: 'Continue Button', Expected: 'Continue' },
  { Field: 'Country Code Present', Expected: 'Yes' },
];

// ═══════════════════════════════════════════════════════════
// SHEET 11: OTP page
// ═══════════════════════════════════════════════════════════
const otpData = [
  { Field: 'Page Title', Expected: 'Enter the code below to continue' },
  { Field: 'Page Description', Expected: 'Enter the code below to continue' },
  { Field: 'OTP Input Present', Expected: 'Yes' },
  { Field: 'Verify Button', Expected: 'Verify' },
  { Field: 'Resend Code Link', Expected: 'Yes' }
];

// ═══════════════════════════════════════════════════════════
// BUILD WORKBOOK AND WRITE FILE
// ═══════════════════════════════════════════════════════════
const wb = XLSX.utils.book_new();

function addSheet(name: string, data: any[]): void {
  const ws = XLSX.utils.json_to_sheet(data);
  const keys = Object.keys(data[0] || {});
  ws['!cols'] = keys.map(k => ({
    wch: Math.max(k.length, ...data.map(r => String(r[k] ?? '').length)) + 2,
  }));
  XLSX.utils.book_append_sheet(wb, ws, name);
}

addSheet('Landing page', landingData);
addSheet('Boxing page', boxingLandingData);
addSheet('PPV page', ppvData);
addSheet('Dazn Plan page', planData);
addSheet('Payment page', paymentData);
addSheet('Schedule page', scheduleData);
addSheet('My Account page', myAccountData);
addSheet('Choose How To Buy page', chooseHowToBuyData);
addSheet('PPV Payment page', ppvPaymentData);
addSheet('Upgrade Confirmation page', upgradeConfirmationData);
addSheet('Phone Number page', phoneNumberData);
addSheet('OTP page', otpData);

const outputDir = path.dirname(outputPath);
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

XLSX.writeFile(wb, outputPath);

console.log('✅ Excel generated successfully!');
console.log(`📁 Path: ${outputPath}`);
console.log(`📋 Sheets: ${wb.SheetNames.join(', ')}`);
console.log(`📊 Rows per sheet:`);
console.log(`   Landing page: ${landingData.length}`);
console.log(`   Boxing page: ${boxingLandingData.length}`);
console.log(`   PPV page: ${ppvData.length}`);
console.log(`   Dazn Plan page: ${planData.length}`);
console.log(`   Payment page: ${paymentData.length}`);
console.log(`   Schedule page: ${scheduleData.length}`);
console.log(`   My Account page: ${myAccountData.length}`);
console.log(`   Choose How To Buy page: ${chooseHowToBuyData.length}`);
console.log(`   PPV Payment page: ${ppvPaymentData.length}`);
console.log(`   Upgrade Confirmation page: ${upgradeConfirmationData.length}`);
console.log(`   Phone Number page: ${phoneNumberData.length}`);
console.log(`   OTP page: ${otpData.length}`);
