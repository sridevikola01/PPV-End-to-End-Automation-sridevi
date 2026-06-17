import { Page } from '@playwright/test';

// ═══════════════════════════════════════════════════════════════
// PAGE TYPE DETECTION (fixed for plan loop)
// ═══════════════════════════════════════════════════════════════
export async function detectPageType(
  p: any,
  pc: Record<string, { detection: string }>,
  planClickCount: number
): Promise<'ppv' | 'plan' | 'email' | 'payment' | 'phone' | 'otp' | 'unknown' | 'standalone-ppv' | 'success-upsell' | 'saved-card-payment' | 'bet-upsell' | 'default-signup'> {
  if (!p || p.isClosed()) return 'unknown';

  // ── Body text detection FIRST for highly specific pages (OTP & Phone) ──
  // This prevents URL-based false positives when SPA navigation updates UI before URL changes
  const body = await p.locator('body')
    .innerText({ timeout: 2000 })
    .then((t: string) => t.toLowerCase())
    .catch(() => '');

  // ── Post-payment pages (must check BEFORE OTP/phone to avoid false positives) ──

  // DAZN Bet / promotional upsell (second success page)
  // Generic: "payment was successful" + bet/promo indicators
  if (body.includes('payment was successful') &&
      (body.includes('dazn bet') || body.includes('free bet') || body.includes('activate betting'))) {
    return 'bet-upsell';
  }

  // PPV upsell success page (first success page after initial payment)
  // Generic: "payment was successful" + upsell buy CTA or dismiss link
  if (body.includes('payment was successful') &&
      (body.includes('buy now for') || body.includes('no thanks'))) {
    return 'success-upsell';
  }

  // Saved card payment page (upsell PPV purchase with card on file)
  // Generic: "one time payment" + any saved card brand/pattern
  if (body.includes('one time payment') &&
      (body.includes('visa') || body.includes('mastercard') || body.includes('amex') ||
       body.includes('****') || body.includes('saved card'))) {
    return 'saved-card-payment';
  }

  // OTP verification page
  if (body.includes('enter the code below') || body.includes('4-digit code') || body.includes('resend code') || body.includes('verify your phone') || body.includes('enter your code')) {
    return 'otp';
  }

  // Phone number page
  if (body.includes('add your phone number')) {
    return 'phone';
  }

  // ── URL-based detection ──────────────
  const url = p.url();
  const urlLower = url.toLowerCase();

  // Phone/OTP pages (highest priority URL checks)
  if (urlLower.includes('phonenumbercollection')) return 'phone';
  if (urlLower.includes('phoneverification') || urlLower.includes('otpverification')) return 'otp';

  // Payment page
  if (urlLower.includes('paymentdetails') || urlLower.includes('page=payment')) return 'payment';

  // Personal details / Email page — MUST be before upsellTierSelected check
  if (urlLower.includes('page=personaldetails')) return 'email';
  if (urlLower.includes('emaildetails')) return 'email';

  // Plan page detection with planClickCount guard
  if (urlLower.includes('upselltierselected=true')) {
    if (planClickCount >= 1) return 'email';
    return 'plan';
  }

  // ── Default Signup page detection (must check BEFORE general PPV) ──
  // The Default Signup page has the same URL pattern (upsellTierShown=true)
  // as the normal PPV page, but uniquely contains "subscribe without a pay-per-view".
  // Normal PPV page only has "Continue with pay-per-view".
  if (
    process.env.DEFAULT_SIGNUP === 'true' &&
    urlLower.includes('upselltiershown=true') &&
    body.includes('subscribe without a pay-per-view')
  ) {
    return 'default-signup';
  }

  if (urlLower.includes('upselltiershown=true')) return 'ppv';
  if (urlLower.includes('upselltierskipped=true')) return 'plan';
  
  // Standalone/Glory PPV page detection (must be before general page=PlanDetails check)
  // Relies on structural indicators (checkbox/toggle) rather than event-name keywords
  // which could appear on ANY page (e.g., "GLORY Collision 9" in headers/breadcrumbs).
  if (urlLower.includes('page=plandetails') && (
    urlLower.includes('standalone') || 
    body.toLowerCase().includes('standalone') ||
    (await p.locator('input[type="checkbox"], button[class*="ni7RX"]').count().catch(() => 0)) > 0
  )) {
    return 'standalone-ppv';
  }

  if (urlLower.includes('page=plandetails')) return 'plan';
  if (urlLower.includes('page=tierplans')) return 'plan';

  // PPV page detection via contextualPpvId query param (before email fallback)
  if (urlLower.includes('/signup') && urlLower.includes('contextualppvid=') && !urlLower.includes('page=')) {
    return 'ppv';
  }

  // ── Rest of fallbacks ─────────────────────────
  // Email/signup page
  if (urlLower.includes('/signup') && !urlLower.includes('plandetails')) return 'email';

  try {
    const emailCount = await p.locator('input[type="email"]').count();
    if (emailCount > 0) return 'email';
  } catch {}

  try {
    const nameCount = await p.locator('[data-test-id="FIRST_NAME"], input[name="firstName"]').count();
    if (nameCount > 0) return 'email';
  } catch {}

  if (body.includes('first name') && body.includes('last name')) return 'email';

  // PPV page detection
  const ppvDetect = pc?.ppv?.detection?.toLowerCase() || '';
  if (ppvDetect && body.includes(ppvDetect)) return 'ppv';
  if (body.includes('subscribe without a pay-per-view')) return 'ppv';
  if (body.includes('choose your plan')) return 'ppv';
  if (body.includes('choose how to buy')) return 'ppv';

  // Standalone/Glory PPV page detection
  if (body.includes("choose a plan that's right") && body.includes("choose your subscription")) {
    const checkboxCount = await p.locator('input[type="checkbox"]').count().catch(() => 0);
    if (checkboxCount > 0) return 'standalone-ppv';
  }

  // Plan page detection (body text fallback)
  if (body.includes("choose a plan that's right")) return 'plan';
  if (body.includes('pick a plan to go with')) return 'plan';

  return 'unknown';
}