export function compare(
  actual:   string,
  expected: string,
  type?:    string
): boolean {
  if (!expected) return true;

  // ── N/A expected ───────────────────────────────────────────────
  if (expected.trim().toUpperCase() === 'N/A') {
    return actual.trim().toUpperCase() === 'N/A';
  }

  const norm = (s: string) =>
    s.replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u00A0]/g, '')
     .replace(/[£$€₹]/g, '')
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
     .replace(/[:\-–]/g, ' ')
     .replace(/\s+/g, ' ')
     .trim()
     .toLowerCase()
     .replace(/\.$/, '');

  const a = norm(actual);
  const e = norm(expected);

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
    s.replace(/[£$€₹,\s]/g, '').trim();
  const aPrice = normPrice(actual);
  const ePrice = normPrice(expected);
  if (aPrice && ePrice && aPrice === ePrice) return true;

  // ── Price length/unit comparison (e.g., "/ month" vs "/month") ──
  if (e.replace(/\s+/g, '') === a.replace(/\s+/g, '') && (e.startsWith('/') || e.startsWith('per'))) {
    return true;
  }

  // ── Contains with length guard ─────────────────────────────────
  if (a.includes(e) && actual.length < expected.length * 10) {
    if (a.includes('not ' + e) || a.includes('not' + e)) return false;
    return true;
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

  if (
    aParts.month && eParts.month &&
    aParts.day   && eParts.day   &&
    aParts.month === eParts.month &&
    aParts.day   === eParts.day
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