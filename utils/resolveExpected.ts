import { getDynamicDateBadge, getDynamicDateTimeBadge } from './dateUtils';

function replacePlaceholders(template: string, eventData: Record<string, string>): string {
  let result = template;
  for (let pass = 0; pass < 2; pass++) {
    result = result.replace(/\{\{(.*?)\}\}/g, (match, key) => {
      const k = key.trim();
      const value =
        eventData[k] ??
        eventData[k.toUpperCase()] ??
        eventData[k.toLowerCase()] ??
        eventData[k.replace(/\s+/g, '_').toUpperCase()] ??
        eventData[k.replace(/\s+/g, '_')];

      if (value === undefined) {
        return match;
      }
      return String(value);
    });
    if (!result.includes('{{')) break;
  }
  return result;
}

export function resolveExpected(
  rule: any,
  eventData: Record<string, string>
): string {
  console.log(`🔍 resolveExpected debug: rule =`, JSON.stringify(rule), `eventData =`, JSON.stringify(eventData));
  const rawField = rule.Field || rule.field || '';
  const field = rawField.trim().toLowerCase();
  const rawTier = rule.Tier || rule.tier || '';
  const tier = rawTier.trim().toLowerCase();
  const rawRatePlan = rule['Rate Plan'] || rule.ratePlan || rule['RatePlan'] || '';
  const ratePlan = rawRatePlan.trim().toLowerCase();

  const rawPage = rule.Page || rule.page || eventData.CURRENT_PAGE || eventData.current_page || '';
  const pageName = rawPage.trim().toLowerCase();

  if (field === 'banner - fight card cta' && pageName.includes('landing')) {
    return 'N/A';
  }

  if (field === 'upsell feature 1' && pageName === 'ppv') {
    return 'Minimum 12 pay-per-views a year included at no extra cost.';
  }

  if (pageName === 'payment') {
    const isReturning =
      String(rule.Flow || rule.flow).toLowerCase() === 'returning' ||
      ['frozen', 'sub_active', 'cancelled'].includes(String(eventData.USER_STATE || process.env.USER_STATE || '').toLowerCase().trim());

    if (!isReturning) {
      if (field === 'signed in as text') return 'N/A';
      if (field === 'log out present') return 'No';
    }
    if (field === 'saved card present') {
      const userState = (eventData.USER_STATE || process.env.USER_STATE || 'freemium').trim().toLowerCase();
      return userState === 'freemium' ? 'No' : 'Yes';
    }
    if (field === 'excluding tax text' || field === 'excluding tax') {
      const region = (eventData.DAZN_REGION || process.env.DAZN_REGION || '').toUpperCase();
      if (region === 'US') {
        return '(excluding tax)';
      }
      return 'N/A';
    }


    // ── Next Payment fields: skip for GB, IT, and 7-day trial ──
    if (field === 'next payment label' || field === 'next payment price') {
      const region = (eventData.DAZN_REGION || process.env.DAZN_REGION || '').toUpperCase();
      const offerType = (eventData.OFFER_TYPE || '').toLowerCase();
      if (region === 'GB' || region === 'IT' || offerType === '7_day_trial') {
        return 'N/A';
      }
    }
  }

  let raw = rule.Expected ?? rule.Value;

  const currentSource = (eventData.SOURCE || eventData.source || '').trim().toLowerCase();


  // Landing banner uses its own display date
  if (
    field === 'banner - event date' &&
    (pageName || '').toLowerCase().startsWith('landing') &&
    eventData.LANDING_BANNER_DATE
  ) {
    return String(eventData.LANDING_BANNER_DATE);
  }


  // Page-specific date expectations
  if (field === 'ppv date and time text') {
    switch ((pageName || "").toLowerCase()) {
      case 'boxing':
        if (eventData.BOXING_BANNER_DATE) return String(eventData.BOXING_BANNER_DATE);
        break;

      case 'landing':
      case 'landing page':
        if (field === 'banner - event date' && eventData.LANDING_BANNER_DATE) {
          return String(eventData.LANDING_BANNER_DATE);
        }
        if (eventData.LANDING_BANNER_DATE) {
          return String(eventData.LANDING_BANNER_DATE);
        }
        break;

      case 'ppv':
        if (eventData.PPV_PAGE_DATE) return String(eventData.PPV_PAGE_DATE);
        break;
    }

    if (eventData.PPV_PAGE_DATE_TIME) {
      return String(eventData.PPV_PAGE_DATE_TIME);
    }
  }

  // Page-specific subtitle expectations
  if (field === 'event subtitle' && (pageName || "").toLowerCase() === 'boxing' && eventData.BOXING_BANNER_SUBTITLE) {
    return String(eventData.BOXING_BANNER_SUBTITLE);
  }


  if (field === 'banner - event description' && eventData.BANNER_DESCRIPTION) {
    return String(eventData.BANNER_DESCRIPTION);
  }

  // home-page-dazntile opens the first eligible DAZN entitlement tile.
  // That tile is not guaranteed to be the configured PPV event, so
  // PPV-specific event-date assertions are not valid for this source.
  if (
    currentSource === 'home-page-dazntile' &&
    (
      field === 'ppv date and time text' ||
      field === 'ppv date' ||
      field === 'ppv time' ||
      field === 'banner - event date'
    )
  ) {
    return 'N/A';
  }

  // Check if a PPV event is active. If a PPV event is active, the boxing subscription-only sources
  // will render the PPV-bundled offers on the live site, so they should be validated using the PPV rules.
  const hasPPVEvent = eventData.PPV_NAME && eventData.PPV_NAME !== 'N/A' && eventData.PPV_NAME !== 'none';
  const isSubscriptionOnly =
    ((currentSource === 'boxing-ultimate-subscription' ||
      currentSource === 'boxing-standard-subscription' ||
      currentSource === 'boxing-join-the-club') &&
      !hasPPVEvent) ||
    eventData.SUBSCRIBE_WITHOUT_PPV === 'true' ||
    process.env.SUBSCRIBE_WITHOUT_PPV === 'true';


  if (isSubscriptionOnly) {
    // In subscription-only flow (no PPV), the plans page shows default descriptions
    // instead of trial/offer text — no trial badge, no trial description
    if (field === 'ppv name' || field === 'ppv price') {
      return 'N/A| |';
    }
    // Flex: no trial badge/today/future text, but show default description
    if (field === 'flex badge') {
      return 'N/A| |';
    }
    if (field === 'flex description') {
      return eventData.PLAN_DETAILS_FLEX_DESC || 'Billed monthly. Cancel anytime.|N/A| |';
    }
    if (field === 'flex today text' || field === 'flex future text') {
      return 'N/A| |';
    }
    // Annual: no 1-month-free badge, but show default description
    if (field === 'annual badge') {
      return 'N/A| |';
    }
    if (field === 'annual price text') {
      return eventData.PLAN_DETAILS_ANNUAL_MONTHLY_DESC || 'Annual contract. Auto renews.|N/A| |';
    }
    if (
      field === 'annual feature 1' ||
      field === 'annual feature 2' ||
      field === 'annual feature 3' ||
      field === 'rate plan original price' ||
      field === 'rate plan discounted price'
    ) {
      return 'N/A| |';
    }
    if (field === 'cta button' || field === 'cta button text' || field === 'cta after apm selection') {
      const currentTierVal = (eventData.TIER || '').toLowerCase();
      if (currentTierVal === 'ultimate') {
        return 'Continue with DAZN Ultimate|Continue';
      } else {
        return 'Continue with DAZN Standard|Continue';
      }
    }
    if (field === 'today you pay price' || field === 'today price' || (field.includes('today you pay') && !field.includes('text'))) {
      const currentTierVal = (eventData.TIER || '').toLowerCase();
      if (currentTierVal === 'ultimate') {
        return eventData.ANNUAL_PAY_MONTHLY_PRICE || '';
      } else {
        return eventData.CURRENCY && eventData.ANNUAL_PRICE ? `${eventData.CURRENCY}${eventData.ANNUAL_PRICE}` : '';
      }
    }
    if (field === 'cancellation text' || field === 'cancel text') {
      const currentTierVal = (eventData.TIER || '').toLowerCase();
      const currentRatePlanVal = (eventData.RATE_PLAN || '').replace(/-/g, ' ').toLowerCase();
      if (currentTierVal === 'ultimate' && currentRatePlanVal.includes('annual pay monthly')) {
        return eventData.CANCELLATION_TEXT_ULTIMATE_APM || '';
      } else if (currentTierVal === 'ultimate' && currentRatePlanVal.includes('annual pay upfront')) {
        return eventData.CANCELLATION_TEXT_ULTIMATE_APU || '';
      } else if (currentRatePlanVal.includes('annual')) {
        const renewalDate = eventData.RENEWAL_DATE || '';
        let cancelText = eventData.CANCELLATION_TEXT_STANDARD_APM || `Your Annual (pay over time) plan will renew automatically on ${renewalDate}. Manage or cancel your annual renewal anytime in My Account. 12-month minimum term`;
        cancelText = cancelText.replace(/\{\{RENEWAL_DATE\}\}/g, renewalDate)
          .replace(/\{\{CURRENCY\}\}/g, eventData.CURRENCY || '')
          .replace(/\{\{MONTHLY_PRICE\}\}/g, eventData.MONTHLY_PRICE || '');
        return cancelText;
      }
    }
    if (field === 'annual savings badge' || field === 'save badge') {
      return eventData.ANNUAL_SAVINGS_BADGE || 'N/A';
    }
  }

  // ── Non-1-month-free offer handling (7_day_trial, no_offer, etc.) ──
  // When OFFER_TYPE is not 1_month_free, the DAZN Plan page should not show
  // 1-month-free promotional expectations (badge, features, price text).
  const currentOfferType = (eventData.OFFER_TYPE || '1_month_free').toLowerCase();
  const currentRatePlan = (eventData.RATE_PLAN || '').replace(/-/g, ' ').toLowerCase();
  const currentTier = (eventData.TIER || '').toLowerCase();
  const isNonFreeMonthOffer = currentOfferType !== '1_month_free';
  const isAnnualFreeMonth = (eventData.ANNUAL_FREE_BADGE || eventData.ANNUAL_BADGE || '').toLowerCase().includes('1 month free') || (eventData.ANNUAL_FREE_BADGE || eventData.ANNUAL_BADGE || '').toLowerCase().includes('1 month');

  if (isNonFreeMonthOffer && !isSubscriptionOnly) {
    // DAZN Plan page: no "1 MONTH FREE" badge, no promotional features/price text
    if (pageName === 'dazn plan' || pageName === 'plan' || pageName === '') {
      if (field === 'annual badge') {
        return isAnnualFreeMonth ? replacePlaceholders(eventData.ANNUAL_FREE_BADGE || eventData.ANNUAL_BADGE || '', eventData) : 'N/A| |';
      }
      if (field === 'annual price text') {
        return isAnnualFreeMonth ? replacePlaceholders(eventData.ANNUAL_PRICE_TEXT || '', eventData) : replacePlaceholders(eventData.PLAN_DETAILS_ANNUAL_MONTHLY_DESC || 'Annual contract. Auto renews.|N/A| |', eventData);
      }
      if (
        field === 'annual feature 1' ||
        field === 'annual feature 2' ||
        field === 'annual feature 3'
      ) {
        if (isAnnualFreeMonth) {
          const featKey = field.toUpperCase().replace(/\s+/g, '_');
          return replacePlaceholders(eventData[featKey] || '', eventData);
        }
        return 'N/A| |';
      }
      if (field === 'annual savings badge') {
        return replacePlaceholders(eventData.ANNUAL_SAVINGS_BADGE || 'N/A', eventData);
      }
    }

    // Payment page overrides for non-1-month-free offers
    if (pageName === 'payment' || pageName === '') {
      // Payment page header for 7-day trial (monthly only — APM/APU always shows 'Choose how to pay')
      if (currentOfferType === '7_day_trial' && !currentRatePlan.includes('annual') && (field === 'header' || field === 'payment page title')) {
        if (eventData.USER_STATE === 'frozen') {
          return eventData.PAYMENT_PAGE_TITLE_STANDARD || 'Choose how to pay';
        }
        return eventData.PAYMENT_PAGE_TITLE_TRIAL || 'Choose how to pay after your free trial';
      }
      if (field === 'rate plan original price' || field === 'rate plan discounted price') {
        return 'N/A| |';
      }
      if (field === 'today you pay price' || field === 'today price' || (field.includes('today you pay') && !field.includes('text'))) {
        return eventData.TODAY_YOU_PAY_PRICE || '';
      }
      if (currentRatePlan.includes('annual')) {
        if (field === 'cancellation text' || field === 'cancel text') {
          if (currentTier === 'ultimate' && currentRatePlan.includes('annual pay monthly')) {
            return eventData.CANCELLATION_TEXT_ULTIMATE_APM || '';
          }
          if (currentTier === 'ultimate' && currentRatePlan.includes('annual pay upfront')) {
            return eventData.CANCELLATION_TEXT_ULTIMATE_APU || '';
          }
          // Standard APM with no 1-month-free: use region-specific standard APM text
          const renewalDate = eventData.RENEWAL_DATE || '';
          let cancelText = eventData.CANCELLATION_TEXT_STANDARD_APM || eventData.CANCELLATION_TEXT_APM_NO_FREE || '';
          if (!cancelText) {
            cancelText = `Your Annual (pay over time) plan will renew automatically on ${renewalDate}. Manage or cancel your annual renewal anytime in My Account. 12-month minimum term`;
          }
          cancelText = cancelText.replace(/\{\{CURRENCY\}\}/g, eventData.CURRENCY || '')
            .replace(/\{\{MONTHLY_PRICE\}\}/g, eventData.MONTHLY_PRICE || '')
            .replace(/\{\{ANNUAL_PRICE\}\}/g, eventData.ANNUAL_PRICE || '')
            .replace(/\{\{ANNUAL_TOTAL\}\}/g, eventData.ANNUAL_TOTAL || '')
            .replace(/\{\{RENEWAL_DATE\}\}/g, renewalDate);
          return cancelText;
        }
      }
    }
  }

  // ── Monthly flex with no offer at all (no_offer / none) ──
  // For PPVs/regions with no 7-day trial and no 1-month-free
  const isReturningUser =
    (eventData.IS_RETURNING_USER === 'true' ||
     ['frozen', 'sub_active', 'cancelled'].includes(String(eventData.USER_STATE || '').toLowerCase().trim())) &&
    (eventData.USER_STATE || '').toLowerCase().trim() !== 'freemium';
  const isNoOffer = currentOfferType === 'no_offer' || currentOfferType === 'none' || isReturningUser;
  const isMonthlyNoOffer = isNoOffer && (currentRatePlan === 'monthly' || currentRatePlan === '');

  if (isMonthlyNoOffer && !isSubscriptionOnly) {
    // DAZN Plan page: no trial badge, no trial description
    if (pageName === 'dazn plan' || pageName === 'plan' || pageName === '') {
      if (field === 'flex badge') {
        return 'N/A| |';
      }
      if (field === 'flex description') {
        return eventData.PLAN_DETAILS_FLEX_DESC || 'Billed monthly. Cancel anytime.|N/A| |';
      }
      if (field === 'flex today text' || field === 'flex future text') {
        return 'N/A| |';
      }
      // Annual fields: no 1 MONTH FREE badge either
      if (field === 'annual badge') {
        return 'N/A| |';
      }
      if (field === 'annual price text') {
        return eventData.PLAN_DETAILS_ANNUAL_MONTHLY_DESC || 'Annual contract. Auto renews.|N/A| |';
      }
      if (
        field === 'annual feature 1' ||
        field === 'annual feature 2' ||
        field === 'annual feature 3'
      ) {
        return 'N/A| |';
      }
    }

    // Payment page: no free pricing
    if (pageName === 'payment' || pageName === '') {
      if (field === 'first month free price' || field === 'first month free text') {
        return 'N/A| |';
      }
      if (field === 'today you pay price' || field === 'today price' || (field.includes('today you pay') && !field.includes('text'))) {
        return eventData.TODAY_YOU_PAY_PRICE || '';
      }
      if (field === 'cancellation text' || field === 'cancel text') {
        return eventData.CANCELLATION_TEXT || "Monthly subscription. Cancel with 30 days' notice. Your subscription auto-renews unless you cancel.";
      }
    }
  }

  if (field === 'popup date' || field === 'popup - event date' || field === 'paywall date' || field === 'paywall - event date') {
    const pDate = eventData.PPV_DATE || '';
    const lpDate = eventData.LANDING_PAGE_PPV_DATE || '';
    if (pDate && lpDate) {
      raw = `${pDate}|${lpDate}`;
    }
  }

  if (raw !== undefined && raw !== null) {
    const currentRatePlan = (eventData.RATE_PLAN || eventData.ratePlan || '').trim().toLowerCase();
    const currentSource = (eventData.SOURCE || eventData.source || '').trim().toLowerCase();

    if (field === 'header' || field === 'page header') {
      if (pageName === 'payment') {
        raw = eventData.PAYMENT_PAGE_TITLE || eventData.PAYMENT_PAGE_TITLE_STANDARD || 'Choose how to pay';
      } else if (eventData.PAYMENT_HEADER) {
        raw = eventData.PAYMENT_HEADER;
      } else if (raw && typeof raw === 'string') {
        raw = raw + '|N/A';
      }
    }

    if (field === 'annual pay upfront save badge' || field === 'save badge') {
      const upfrontSaveDisplay = eventData.UPFRONT_SAVE_AMOUNT_DISPLAY || eventData.UPFRONT_SAVE_AMOUNT;
      if (upfrontSaveDisplay === 'N/A' || !upfrontSaveDisplay || parseFloat(upfrontSaveDisplay.replace(/[^\d.-]/g, '')) <= 0) {
        raw = 'N/A';
      }
    }

    const currentTier = (eventData.TIER || '').trim().toLowerCase();
    const isDefaultSignup =
      process.env.DEFAULT_SIGNUP === 'true' ||
      currentSource === 'home-page-get-started' ||
      currentSource === 'home-page-dazntile' ||
      currentSource === 'boxing-ultimate-subscription' ||
      currentSource === 'boxing-standard-subscription' ||
      currentSource === 'boxing-join-the-club' ||
      currentSource === 'boxing-banner-ultimate';

    if (field === 'upsell offer text' && (!eventData.UPSELL_PRICE || eventData.UPSELL_PRICE.trim() === '' || eventData.UPSELL_PRICE.trim().toUpperCase() === 'N/A')) {
      raw = 'N/A';
    } else if (field === 'annual pay monthly contract text' && (!eventData.UPSELL_PRICE || eventData.UPSELL_PRICE.trim() === '' || eventData.UPSELL_PRICE.trim().toUpperCase() === 'N/A')) {
      raw = 'Annual contract. Auto renews.';
    } else if (field === 'ppv name' && isDefaultSignup) {
      raw = 'N/A';
    } else if (field === 'ppv price' && isDefaultSignup) {
      raw = 'N/A';
    } else if (field === 'ultimate feature 1' || field === 'ultimate feature 2' || field === 'ultimate feature 3') {
      if (
        currentSource !== 'boxing-ultimate' &&
        currentSource !== 'boxing-banner-ultimate' &&
        currentSource !== 'boxing-ultimate-subscription' &&
        currentSource !== 'boxing-join-the-club'
      ) {
        raw = 'N/A';
      }
    } else if (field === 'next payment label') {
      if (ratePlan.includes('annual pay monthly')) {
        raw = 'Next payment on {{NEXT_PAYMENT_DATE}}';
      } else if (ratePlan.includes('annual pay upfront')) {
        raw = 'Next Annual payment on {{NEXT_PAYMENT_DATE}}';
      }
    } else if (field === 'next payment price') {
      if (ratePlan.includes('annual pay monthly')) {
        raw = '{{ANNUAL_PAY_MONTHLY_PRICE}}';
      } else if (ratePlan.includes('annual pay upfront')) {
        raw = '{{ANNUAL_UPFRONT_PRICE}}';
      }
    } else if (field === 'cancellation text' && tier === 'ultimate') {
      if (ratePlan.includes('annual pay monthly')) {
        raw = '{{CANCELLATION_TEXT_ULTIMATE_APM}}';
      } else if (ratePlan.includes('annual pay upfront')) {
        raw = '{{CANCELLATION_TEXT_ULTIMATE_APU}}';
      }
    } else if (field === 'cta button' && (rule.Flow === 'boxing-bundle-ppv' || rule.flow === 'boxing-bundle-ppv')) {
      const currentTier = (eventData.TIER || eventData.tier || '').trim().toLowerCase();
      if (currentTier === 'ultimate') {
        raw = 'Continue with DAZN Ultimate|Continue with pay-per-view';
      } else {
        raw = 'Continue with pay-per-view';
      }
    } else if (field === 'offer original price' || field === 'offer price original') {
      const offerAvailable = String(eventData.OFFER_AVAILABLE || 'false').toLowerCase() === 'true';
      if (!offerAvailable) {
        raw = 'N/A';
      } else if (raw && raw.includes('{{')) {
        const resolved = raw.replace(/\{\{(.*?)\}\}/g, (match: string, k: string) => {
          const val = eventData[k] || eventData[k.toUpperCase()] || eventData[k.toLowerCase()] || eventData[k.replace(/\s+/g, '_').toUpperCase()] || eventData[k.replace(/\s+/g, '_')];
          return val !== undefined ? String(val) : `{{${k}}}`;
        });
        raw = resolved;
      }
    } else if (field === 'offer discount' || field === 'offer discount amount' || field === 'offer save amount') {
      const offerAvailable = String(eventData.OFFER_AVAILABLE || 'false').toLowerCase() === 'true';
      if (!offerAvailable) {
        raw = 'N/A';
      } else if (raw && raw.includes('{{')) {
        const discountNum = parseFloat(String(eventData.OFFER_DISCOUNT_AMOUNT || '').replace(/[^0-9.]/g, ''));
        const discountText = !isNaN(discountNum) && discountNum > 0 ? `Save ${discountNum.toFixed(0)}%` : 'N/A';
        raw = raw.replace(/\{\{OFFER_DISCOUNT_AMOUNT\}\}/g, discountText).replace(/\{\{(.*?)\}\}/g, (match: string, k: string) => {
          const val = eventData[k] || eventData[k.toUpperCase()] || eventData[k.toLowerCase()] || eventData[k.replace(/\s+/g, '_').toUpperCase()] || eventData[k.replace(/\s+/g, '_')];
          return val !== undefined ? String(val) : `{{${k}}}`;
        });
      }
    } else if (field === 'offer badge' || field === 'offer description') {
      const offerAvailable = String(eventData.OFFER_AVAILABLE || 'false').toLowerCase() === 'true';
      if (!offerAvailable) {
        raw = 'N/A';
      } else if (raw && raw.includes('{{')) {
        const offerBadge = String(eventData.OFFER_BADGE || '');
        const offerDesc = String(eventData.OFFER_DESCRIPTION || '');
        if (field === 'offer badge') {
          raw = raw.replace(/\{\{OFFER_BADGE\}\}/g, offerBadge || 'N/A').replace(/\{\{(.*?)\}\}/g, (match: string, k: string) => {
            const val = eventData[k] || eventData[k.toUpperCase()] || eventData[k.toLowerCase()] || eventData[k.replace(/\s+/g, '_').toUpperCase()] || eventData[k.replace(/\s+/g, '_')];
            return val !== undefined ? String(val) : `{{${k}}}`;
          });
        } else {
          raw = raw.replace(/\{\{OFFER_DESCRIPTION\}\}/g, offerDesc || 'N/A').replace(/\{\{(.*?)\}\}/g, (match: string, k: string) => {
            const val = eventData[k] || eventData[k.toUpperCase()] || eventData[k.toLowerCase()] || eventData[k.replace(/\s+/g, '_').toUpperCase()] || eventData[k.replace(/\s+/g, '_')];
            return val !== undefined ? String(val) : `{{${k}}}`;
          });
        }
      }
    } else if (field === 'today you pay price' || field === 'today price' || (field.includes('today you pay') && !field.includes('text'))) {
      if (eventData.TODAY_YOU_PAY_PRICE) {
        raw = eventData.TODAY_YOU_PAY_PRICE;
      } else {
        const offerAvailable = String(eventData.OFFER_AVAILABLE || 'false').toLowerCase() === 'true';
        if (offerAvailable && (eventData.OFFER_EFFECTIVE_PPV_PRICE || eventData.UPSELL_PRICE)) {
          raw = eventData.OFFER_EFFECTIVE_PPV_PRICE || eventData.UPSELL_PRICE || raw;
        }
      }
    }
  }

  const activeOfferPresent = String(eventData.ACTIVE_OFFER_PRESENT || 'false').toLowerCase() === 'true';
  const offerType = eventData.ACTIVE_OFFER_TYPE || 'default';

  if (activeOfferPresent) {
    if (field === 'ppv price' && offerType === 'ppv_only_offer') {
      return eventData.OFFER_EFFECTIVE_PPV_PRICE || '';
    }
    if (field === 'offer original price' || field === 'offer price original' || field === 'original price' || field === 'was price') {
      if (offerType === 'ppv_only_offer') return eventData.OFFER_ORIGINAL_PPV_PRICE || '';
      return eventData.RATE_PLAN_ORIGINAL_PRICE || 'N/A';
    }
    if (field === 'offer discount' || field === 'offer discount amount' || field === 'offer save amount' || field === 'discount badge') {
      if (offerType === 'ppv_only_offer') return eventData.OFFER_DISCOUNT_AMOUNT || '';
      return eventData.DISCOUNT_BADGE || 'N/A';
    }
    if (field === 'offer badge' || field === 'flex badge') {
      if (offerType === 'ppv_only_offer') return eventData.OFFER_BADGE || '';
      return 'N/A';
    }
    if (field === 'offer description' || field === 'flex description' || field === 'ppv card description') {
      if (offerType === 'ppv_only_offer') {
        if (field === 'flex description') return 'N/A';
        return eventData.OFFER_DESCRIPTION || '';
      }
      return eventData.OFFER_DESCRIPTION || '';
    }
    if (field === 'cancellation text' || field === 'cancel text') {
      let cancelTemplate = eventData.CANCELLATION_TEXT || '';
      for (let pass = 0; pass < 2; pass++) {
        cancelTemplate = cancelTemplate.replace(/\{\{(.*?)\}\}/g, (match, key) => {
          const k = key.trim();
          const val = eventData[k] ?? eventData[k.toUpperCase()] ?? eventData[k.toLowerCase()] ?? eventData[k.replace(/\s+/g, '_').toUpperCase()] ?? eventData[k.replace(/\s+/g, '_')];
          return val !== undefined ? String(val) : match;
        });
        if (!cancelTemplate.includes('{{')) break;
      }
      return cancelTemplate;
    }
    if (field === 'today you pay price' || field === 'today price' || (field.includes('today you pay') && !field.includes('text'))) {
      return eventData.TODAY_YOU_PAY_PRICE || '';
    }
    if (field === 'plan name' || field === 'plan label') {
      return eventData.PAYMENT_PLAN_LABEL || eventData.PLAN_LABEL || '';
    }
    if (field === 'flex today text' || field === 'flex future text' || field === 'first month free price' || field === 'first month free text') {
      return offerType === 'ppv_only_offer' ? 'N/A' : '';
    }
    if (field === 'bundle price' && offerType === 'bundle_offer') {
      return eventData.BUNDLE_PRICE || '';
    }
    if (field === 'bundle original price' && offerType === 'bundle_offer') {
      return eventData.BUNDLE_ORIGINAL_PRICE || '';
    }
    if (field === 'bundle save badge' && offerType === 'bundle_offer') {
      return eventData.BUNDLE_SAVE_BADGE || '';
    }
    if (field === 'bundle discount' && offerType === 'bundle_offer') {
      return eventData.BUNDLE_DISCOUNT || '';
    }
    if (field === 'bundle description' && offerType === 'bundle_offer') {
      return eventData.OFFER_DESCRIPTION || '';
    }
  }

  if (field === 'ppv card description') {
    const isStag = (process.env.DAZN_ENV || 'stag').toLowerCase().includes('stag');
    if (isStag && process.env.DEFAULT_SIGNUP === 'true') {
      raw = eventData.DEFAULT_SIGNUP_PPV_DESCRIPTION || 'The fight, including one month of discounted DAZN Standard plan';
    }
  } else if (field === 'upsell section heading') {
    if (process.env.DEFAULT_SIGNUP === 'true') {
      raw = 'N/A';
    }
  }

  if (raw === undefined || raw === null || raw === '') {
    return '';
  }

  let template = String(raw);

  // Run replacement twice to handle nested placeholders
  // e.g., {{CANCELLATION_TEXT}} → "...{{NEXT_PAYMENT_DATE}}..." → "...23/06/2026..."
  for (let pass = 0; pass < 2; pass++) {
    template = template.replace(/\{\{(.*?)\}\}/g, (match, key) => {
      const k = key.trim();

      // Override PPV_DATE specifically for landing/boxing/home pages
      // BUT NOT for banner fields — banners show the full PPV_DATE (e.g. 'Sat 27th Jun at 16:30')
      const pageNameLower = pageName.toLowerCase();
      const isBannerField = field.startsWith('banner');
      if (k.toUpperCase() === 'PPV_DATE' && !isBannerField && (pageNameLower === 'landing' || pageNameLower === 'boxing' || pageNameLower.includes('home'))) {
        if (eventData.LANDING_PAGE_PPV_DATE) {
          return String(eventData.LANDING_PAGE_PPV_DATE);
        }
      }

      const value =
        eventData[k] ??
        eventData[k.toUpperCase()] ??
        eventData[k.toLowerCase()] ??
        eventData[k.replace(/\s+/g, '_').toUpperCase()] ??
        eventData[k.replace(/\s+/g, '_')];

      if (value === undefined) {
        if (pass === 0) return match;
        console.warn(`⚠️  resolveExpected: no value for {{${k}}} — leaving as-is`);
        return match;
      }

      return String(value);
    });

    if (!template.includes('{{')) break;
  }

  if (field === 'cta button' || field === 'cta button text') {
    if (template === 'Continue with PPV + 7-day free trial') {
      template = 'Continue with 7-day Free Trial';
    }
  } else if (field === 'cancellation text' || field === 'cancel text') {
    const currentTierVal = (eventData.TIER || '').toLowerCase();
    const currentRatePlanVal = (eventData.RATE_PLAN || '').replace(/-/g, ' ').toLowerCase();
    const offerTypeVal = (eventData.OFFER_TYPE || '').toLowerCase();

    if (currentTierVal === 'ultimate' && currentRatePlanVal.includes('annual pay monthly')) {
      // Ultimate Annual Pay Monthly
      template = eventData.CANCELLATION_TEXT_ULTIMATE_APM || '';
    } else if (currentTierVal === 'ultimate' && currentRatePlanVal.includes('annual pay upfront')) {
      // Ultimate Annual Pay Upfront
      template = eventData.CANCELLATION_TEXT_ULTIMATE_APU || '';
    } else if (currentRatePlanVal.includes('annual')) {
      // Standard Annual — if we have a 1-month free offer, prefer offer-specific CANCELLATION_TEXT_ANNUAL
      if (offerTypeVal === '1_month_free') {
        template = eventData.CANCELLATION_TEXT_ANNUAL || eventData.CANCELLATION_TEXT_STANDARD_APM || '';
      } else {
        template = eventData.CANCELLATION_TEXT_STANDARD_APM || eventData.CANCELLATION_TEXT_ANNUAL || '';
      }
    } else if (offerTypeVal === '7_day_trial') {
      // 7-day trial (monthly flex)
      template = eventData.CANCELLATION_TEXT_TRIAL || "In 7 days, you'll be charged {{CURRENCY}}{{MONTHLY_PRICE}}/month. Cancel anytime before the end of the trial.";
    } else if (offerTypeVal === '1_month_free') {
      // 1 month free (non-trial regions or monthly flex with 1-month offer)
      template = eventData.CANCELLATION_TEXT || eventData.CANCELLATION_TEXT_TRIAL || '';
    } else {
      // Default monthly — use pre-set CANCELLATION_TEXT if available
      template = eventData.CANCELLATION_TEXT || "Monthly subscription. Cancel with 30 days' notice. Your subscription auto-renews unless you cancel.";
    }

    // Resolve any remaining template placeholders
    template = template.replace(/\{\{CURRENCY\}\}/g, eventData.CURRENCY || '')
      .replace(/\{\{MONTHLY_PRICE\}\}/g, eventData.MONTHLY_PRICE || '')
      .replace(/\{\{ANNUAL_PRICE\}\}/g, eventData.ANNUAL_PRICE || '')
      .replace(/\{\{ANNUAL_TOTAL\}\}/g, eventData.ANNUAL_TOTAL || '')
      .replace(/\{\{RENEWAL_DATE\}\}/g, eventData.RENEWAL_DATE || '');
  }

  // Clean up any duplicate currency symbols (e.g., $$ or ££)
  const currencySymbol = eventData.CURRENCY || '';
  if (currencySymbol) {
    const doubleCurrency = `${currencySymbol}${currencySymbol}`;
    while (template.includes(doubleCurrency)) {
      template = template.replace(doubleCurrency, currencySymbol);
    }
  }

  // Date-only fields — use getDynamicDateBadge (generates candidates with and without time)
  const dateOnlyFields = [
    'ppv date badge',
    'date badge',
    'banner date badge',
    'banner - event date',
    'upsell date badge',
    'tile date badge',
    'ppv date',
    'popup date',
    'popup - event date',
    'paywall date',
    'paywall - event date',
    'welcome tile date',
    'event date',
    'fury payment date',
    'landing page ppv date',
    'ppv1 upsell tile date',
    'ppv2 upsell tile date',
  ];
  if (dateOnlyFields.includes(field)) {
    return getDynamicDateBadge(template);
  }

  // Date+Time fields — use getDynamicDateTimeBadge (only generates candidates WITH time)
  const dateTimeFields = [
    'ppv date and time',
    'ppv date and time expected',
    'ppv date and time text',
    'ppv1 date and time text on bundle',
    'event date and time',
  ];
  if (dateTimeFields.includes(field)) {
    return getDynamicDateTimeBadge(template);
  }

  return template;
}