export function compare(
  actual:   string,
  expected: string,
  type?:    string
): boolean {
  if (!expected) {
    // Empty expected: pass only if actual is also empty or N/A
    const aTrimmed = actual.trim();
    return aTrimmed === '' || aTrimmed.toUpperCase() === 'N/A';
  }

  // ── N/A expected ───────────────────────────────────────────────
  if (expected.trim().toUpperCase() === 'N/A') {
    return actual.trim().toUpperCase() === 'N/A';
  }

  const norm = (s: string) =>
    s.replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u00A0]/g, '')
     .replace(/[£$€₹]|AED\s?/g, '')
     .replace(/'/gi, "'")
     .replace(/&#39;/gi, "'")
     .replace(/&apos;/gi, "'")
     .replace(/&quot;/gi, '"')
     .replace(/&amp;/gi, '&')
     .replace(/&lt;/gi, '<')
     .replace(/&gt;/gi, '>')
     .replace(/"/gi, '"')
     .replace(/&/gi, '&')
     .replace(/[\u2018\u2019\u201A\u201B\u2032\u0060\u00B4]/g, "'")
     .replace(/[\u201C\u201D\u201E\u201F\u2033]/g, '"')
     .replace(/\bppv\b/gi, '')
     .replace(/[\-–—\u2014\u2013]/g, ' ')
     .replace(/\s+/g, ' ')
     .trim()
     .toLowerCase()
     .replace(/\.$/, '');

  const a = norm(actual);
  const e = norm(expected);

  // ── Price duplication check ─────────────────────────────────────
  const priceRegex = /\d+(?:\.\d{2})?/;
  const expectedPrices = e.match(new RegExp(priceRegex.source, 'g')) || [];
  const actualPrices = a.match(new RegExp(priceRegex.source, 'g')) || [];
  if (expectedPrices.length === 1 && actualPrices.length > 1) {
    const singleExpected = expectedPrices[0];
    const occurrences = actualPrices.filter(p => p === singleExpected).length;
    if (occurrences > 1) {
      console.log(`❌ [Compare] Price duplication detected: "${singleExpected}" appears ${occurrences} times in actual "${actual}"`);
      return false;
    }
  }

  // ── Matchups Substring Match (e.g. "Beauty and The Beast: Fury vs. Hall" <-> "Fury vs. Hall") ──
  if (a.includes('vs') && e.includes('vs')) {
    const eParts = e.split('vs');
    if (eParts.length >= 2) {
      const leftWords = eParts[0].trim().split(/\s+/).map(w => w.replace(/[^a-z0-9]/gi, '')).filter(w => w.length > 0);
      const rightWords = eParts[1].trim().split(/\s+/).map(w => w.replace(/[^a-z0-9]/gi, '')).filter(w => w.length > 0);
      const leftFighter = leftWords[leftWords.length - 1];
      const rightFighter = rightWords[0];
      if (leftFighter && rightFighter && leftFighter.length >= 2 && rightFighter.length >= 2) {
        if (a.includes(leftFighter) && a.includes(rightFighter)) {
          return true;
        }
      }
    }
  }

  if ((a.includes(e) || e.includes(a)) && (a.includes('vs') || e.includes('vs'))) {
    return true;
  }

  // ── Yes/No ─────────────────────────────────────────────────────
  if (e === 'yes') return a === 'yes' || actual === 'Yes' || a.includes('buy') || a.includes('continue');
  if (e === 'no')  return a === 'no'  || actual === 'No';

  // ── Gold ───────────────────────────────────────────────────────
  if (e === 'gold') return a === 'gold' || actual === 'Gold';

  // ── Pipe-separated multiple valid values ───────────────────────
  if (expected.includes('|')) {
    const options = expected.split('|');
    return options.some(opt => compare(actual, opt.trim(), type));
  }

  // ── Type overrides ─────────────────────────────────────────────
  if (type === 'contains')   return a.includes(e);
  if (type === 'startsWith') return a.startsWith(e);

  // ── Exact match ────────────────────────────────────────────────
  if (a === e) return true;

  // ── Trailing period flexibility ────────────────────────────────
  if (a.replace(/\.$/, '') === e.replace(/\.$/, '')) return true;

  // ── Price comparison ───────────────────────────────────────────
  const normPrice = (s: string) =>
    s.replace(/[£$€₹,\s]|AED\s?/g, '').trim();
  const aPrice = normPrice(actual);
  const ePrice = normPrice(expected);
  if (aPrice && ePrice && aPrice === ePrice) return true;

  // ── Price length/unit comparison (e.g., "/ month" vs "/month") ──
  if (e.replace(/\s+/g, '') === a.replace(/\s+/g, '') && (e.startsWith('/') || e.startsWith('per'))) {
    return true;
  }

  // ── Contains with length guard ─────────────────────────────
  // Only allow substring match for very close-length strings to avoid false positives
  // where a short expected matches inside a large page-text dump.
  if (
    a.includes(e) &&
    e.length >= 10 &&
    actual.length < expected.length * 1.5 &&
    actual.length <= expected.length + 30
  ) {
    if (a.includes('not ' + e) || a.includes('not' + e)) return false;
    return true;
  }

  // ── PPV Name: Abbreviated promotion prefix matching ─────────────
  // Config may use abbreviated names like "AEW: Forbidden Door" or "PFL: Champions"
  // but the live site displays "All Elite Wrestling Forbidden Door" or "Professional Fighters League Champions".
  // Match if the part after the colon appears in the actual text and the actual text is
  // genuinely longer (full name expansion), NOT just the colon removed.
  if (expected.includes(':')) {
    const beforeColon = norm(expected.split(':')[0].trim());
    const afterColon = norm(expected.split(':').slice(1).join(':').trim());
    // Only match if: (a) the part after colon appears in actual,
    // (b) the actual text is genuinely longer than expected (suggesting full name expansion),
    // (c) the prefix before the colon is NOT present as-is in actual (it was expanded).
    if (
      afterColon.length >= 5 &&
      a.includes(afterColon) &&
      actual.length > expected.length * 1.1 &&
      !a.includes(beforeColon + ' ' + afterColon)
    ) {
      return true;
    }
  }
  // Reverse: actual has colon, expected doesn't — only if expected is genuinely longer
  if (actual.includes(':') && !expected.includes(':')) {
    const beforeColonActual = norm(actual.split(':')[0].trim());
    const afterColonActual = norm(actual.split(':').slice(1).join(':').trim());
    if (
      afterColonActual.length >= 5 &&
      e.includes(afterColonActual) &&
      expected.length > actual.length * 1.1 &&
      !e.includes(beforeColonActual + ' ' + afterColonActual)
    ) {
      return true;
    }
  }

  // ── Date flexibility ───────────────────────────────────────────
  const extractDateParts = (s: string) => {
    const months = [
      'jan','feb','mar','apr','may','jun',
      'jul','aug','sep','oct','nov','dec'
    ];
    const month = months.find(m => s.toLowerCase().includes(m));
    const day   = s.match(/\b(\d{1,2})(st|nd|rd|th)?\b/)?.[1];
    return { month, day };
  };

  const aParts = extractDateParts(a);
  const eParts = extractDateParts(e);

  // Date-only flexibility: only use when NEITHER string contains a time component.
  // If the actual has time info (e.g. "Sun 26th Jul at 00:30") but expected doesn't
  // (e.g. "26 Jul"), this should NOT pass — the expected should include the time.
  const actualHasTime = /\b\d{1,2}:\d{2}\b/.test(actual);
  const expectedHasTime = /\b\d{1,2}:\d{2}\b/.test(expected);
  if (
    aParts.month && eParts.month &&
    aParts.day   && eParts.day   &&
    aParts.month === eParts.month &&
    aParts.day   === eParts.day &&
    !actualHasTime && !expectedHasTime
  ) return true;

  // ── Time match flexibility ─────────────────────────────────────
  // Helper to convert time string (12-hour or 24-hour) to minutes since midnight
  const parseToMinutes = (str: string): number | null => {
    const m12 = str.match(/(\d{1,2}):(\d{2})\s*(am|pm)/i);
    if (m12) {
      let h = parseInt(m12[1], 10);
      const m = parseInt(m12[2], 10);
      const period = m12[3].toLowerCase();
      if (period === 'pm' && h < 12) h += 12;
      if (period === 'am' && h === 12) h = 0;
      return h * 60 + m;
    }
    const m24 = str.match(/(\d{1,2}):(\d{2})/);
    if (m24) {
      const h = parseInt(m24[1], 10);
      const m = parseInt(m24[2], 10);
      if (h >= 0 && h < 24 && m >= 0 && m < 60) {
        return h * 60 + m;
      }
    }
    return null;
  };

  const aTimeMinutes = parseToMinutes(actual);
  const eTimeMinutes = parseToMinutes(expected);
  if (aTimeMinutes !== null && eTimeMinutes !== null && aTimeMinutes === eTimeMinutes) {
    const cleanTime = (s: string) => s.replace(/\d{1,2}:\d{2}\s*(?:am|pm)?/gi, '').replace(/\s+/g, ' ').trim();
    
    // Normalize weekday names & strip date/month parts (e.g. "13th Jun", "27th Jun")
    const normalizeDayAndStripDate = (str: string) => {
      let s = norm(cleanTime(str));
      s = s.replace(/\bsaturday\b/g, 'sat')
           .replace(/\bsunday\b/g, 'sun')
           .replace(/\bmonday\b/g, 'mon')
           .replace(/\btuesday\b/g, 'tue')
           .replace(/\bwednesday\b/g, 'wed')
           .replace(/\bthursday\b/g, 'thu')
           .replace(/\bfriday\b/g, 'fri');
      // Strip month names
      s = s.replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\b/g, '');
      // Strip day numbers like 13th, 27th, 3, etc.
      s = s.replace(/\b\d{1,2}(st|nd|rd|th)?\b/g, '');
      // Clean up whitespace
      return s.replace(/\s+/g, ' ').trim();
    };

    const aClean = normalizeDayAndStripDate(actual);
    const eClean = normalizeDayAndStripDate(expected);
    if (aClean === eClean || aClean.includes(eClean) || eClean.includes(aClean)) {
      return true;
    }
  }

  // ── Time timezone flexibility ──────────────────────────────────
  // If both strings have a time format, but they might differ due to timezone,
  // compare their text contents with the time part stripped.
  // Use separate regex instances for .test() to avoid g-flag lastIndex issue
  const hasTimeA = /\b\d{1,2}:\d{2}\s*(?:am|pm)?\.?\b/i.test(actual);
  const hasTimeE = /\b\d{1,2}:\d{2}\s*(?:am|pm)?\.?\b/i.test(expected);
  if (hasTimeA && hasTimeE) {
    const stripTime = (s: string) => s.replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\.?\b/gi, '').replace(/\s+/g, ' ').trim();
    const aNoTime = stripTime(actual);
    const eNoTime = stripTime(expected);
    if (norm(aNoTime) === norm(eNoTime) || norm(aNoTime).includes(norm(eNoTime)) || norm(eNoTime).includes(norm(aNoTime))) {
      return true;
    }
  }

  return false;
}