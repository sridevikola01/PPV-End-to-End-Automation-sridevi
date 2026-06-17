export function getNowIST(): Date {
  // Returns current time expressed as a Date object in IST (UTC+5:30)
  // Works correctly on any server timezone including UTC CI environments
  const now = new Date();
  const utcMs = now.getTime() + (now.getTimezoneOffset() * 60000);
  const istOffsetMs = 5.5 * 60 * 60 * 1000; // IST = UTC+5:30
  return new Date(utcMs + istOffsetMs);
}

export function formatNextPaymentDate(daysOffset: number): string {
  const date = getNowIST();
  date.setDate(date.getDate() + daysOffset);

  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  return `${dd}/${mm}/${yyyy}`;
}

// ✅ New helper — adds exactly 1 calendar month
export function formatNextPaymentDateMonthly(): string {
  const date = getNowIST();
  date.setMonth(date.getMonth() + 1);

  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  return `${dd}/${mm}/${yyyy}`;
}

// ✅ New helper — adds exactly 1 calendar year
export function formatNextPaymentDateYearly(): string {
  const date = getNowIST();
  date.setFullYear(date.getFullYear() + 1);

  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  return `${dd}/${mm}/${yyyy}`;
}

// ── US format MM.DD.YYYY ──────────────────────────────────────

// US monthly — 1 month from today in MM.DD.YYYY
export function formatNextPaymentDateMonthlyUS(): string {
  const date = getNowIST();
  date.setMonth(date.getMonth() + 1);

  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  return `${mm}/${dd}/${yyyy}`;
}

// US yearly — 1 year from today in MM.DD.YYYY
export function formatNextPaymentDateYearlyUS(): string {
  const date = getNowIST();
  date.setFullYear(date.getFullYear() + 1);

  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  return `${mm}/${dd}/${yyyy}`;
}

// US offset — N days from today in MM.DD.YYYY
export function formatNextPaymentDateUS(daysOffset: number): string {
  const date = getNowIST();
  date.setDate(date.getDate() + daysOffset);

  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  return `${mm}/${dd}/${yyyy}`;
}

// ── Flex Future Date — "In 7 days • 4 June 2026" ────────────
export function formatFlexFutureDate(daysOffset: number = 7): string {
  const date = getNowIST();
  date.setDate(date.getDate() + daysOffset);

  const day   = date.getDate(); // no padding
  const month = date.toLocaleString('en-GB', { month: 'long' });
  const year  = date.getFullYear();

  return `In ${daysOffset} days • ${day} ${month} ${year}`;
}

// ✅ Renewal date helper — 1 year minus 1 day from today in DD/MM/YYYY
export function formatRenewalDate(): string {
  const date = getNowIST();
  date.setFullYear(date.getFullYear() + 1);
  date.setDate(date.getDate() - 1);

  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  return `${dd}/${mm}/${yyyy}`;
}

// ✅ US renewal date helper — 1 year minus 1 day from today in MM/DD/YYYY
export function formatRenewalDateUS(): string {
  const date = getNowIST();
  date.setFullYear(date.getFullYear() + 1);
  date.setDate(date.getDate() - 1);

  const dd   = String(date.getDate()).padStart(2, '0');
  const mm   = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();

  return `${mm}/${dd}/${yyyy}`;
}

export function parseConfigDate(configStr: string, referenceDate: Date = getNowIST()): Date {
  const clean = configStr.toLowerCase().replace(/\bat\b/g, ' ').replace(/\s+/g, ' ').trim();
  
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const fullMonths = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
  
  let monthIdx = -1;
  let dayNum = -1;
  
  for (let i = 0; i < 12; i++) {
    if (clean.includes(months[i]) || clean.includes(fullMonths[i])) {
      monthIdx = i;
      break;
    }
  }
  
  if (monthIdx !== -1) {
    const dayMatch = clean.match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (dayMatch) {
      dayNum = parseInt(dayMatch[1], 10);
    }
  }
  
  let hours = 20;
  let minutes = 0;
  const timeMatch = clean.match(/(\d{1,2}):(\d{2})\s*(pm|am)?/);
  if (timeMatch) {
    hours = parseInt(timeMatch[1], 10);
    minutes = parseInt(timeMatch[2], 10);
    const ampm = timeMatch[3];
    if (ampm === 'pm' && hours < 12) hours += 12;
    if (ampm === 'am' && hours === 12) hours = 0;
  }
  
  if (monthIdx !== -1 && dayNum !== -1) {
    const targetDate = new Date(referenceDate);
    targetDate.setMonth(monthIdx);
    targetDate.setDate(dayNum);
    targetDate.setHours(hours, minutes, 0, 0);
    targetDate.setFullYear(referenceDate.getFullYear());
    
    if (targetDate.getTime() < referenceDate.getTime() - 30 * 24 * 3600 * 1000) {
      targetDate.setFullYear(referenceDate.getFullYear() + 1);
    }
    return targetDate;
  }
  
  const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  let weekdayIdx = -1;
  for (let i = 0; i < 7; i++) {
    if (clean.includes(weekdays[i]) || clean.includes(weekdays[i].substring(0, 3))) {
      weekdayIdx = i;
      break;
    }
  }
  
  if (weekdayIdx !== -1) {
    const targetDate = new Date(referenceDate);
    targetDate.setHours(hours, minutes, 0, 0);
    
    const refDay = referenceDate.getDay();
    let daysDiff = weekdayIdx - refDay;
    if (daysDiff < 0) {
      daysDiff += 7;
    } else if (daysDiff === 0) {
      const temp = new Date(targetDate);
      if (temp.getTime() < referenceDate.getTime()) {
        daysDiff += 7;
      }
    }
    targetDate.setDate(targetDate.getDate() + daysDiff);
    return targetDate;
  }
  
  const fallbackDate = new Date(referenceDate);
  fallbackDate.setDate(fallbackDate.getDate() + 1);
  return fallbackDate;
}

function getDynamicDateBadgeSingle(configStr: string, referenceDate: Date = getNowIST()): string {
  if (configStr.toUpperCase() === 'N/A' || !configStr.trim()) {
    return configStr;
  }
  const eventDate = parseConfigDate(configStr, referenceDate);
  
  const refDateStart = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const eventDateStart = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());
  const diffTime = eventDateStart.getTime() - refDateStart.getTime();
  const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
  
  const hours = eventDate.getHours();
  const minutes = String(eventDate.getMinutes()).padStart(2, '0');
  
  const time24 = `${String(hours).padStart(2, '0')}:${minutes}`;
  const ampm = hours >= 12 ? 'PM' : 'AM';
  const hours12 = hours % 12 || 12;
  const time12 = `${hours12}:${minutes}${ampm}`;
  const time12Spaced = `${hours12}:${minutes} ${ampm}`;
  const time12Lower = `${hours12}:${minutes}${ampm.toLowerCase()}`;
  const time12LowerSpaced = `${hours12}:${minutes} ${ampm.toLowerCase()}`;
  
  const times = [time24, time12, time12Spaced, time12Lower, time12LowerSpaced];
  
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const fullDayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const dayName = dayNames[eventDate.getDay()];
  const fullDayName = fullDayNames[eventDate.getDay()];
  
  const candidates = new Set<string>();
  
  // Helper to add day-of-week variations
  const addDayVariations = (day: string) => {
    for (const t of times) {
      candidates.add(`${day} at ${t}`);
      candidates.add(`${day} ${t}`);
      candidates.add(`${day.toUpperCase()} at ${t}`);
      candidates.add(`${day.toUpperCase()} ${t}`);
      candidates.add(`${day.toLowerCase()} at ${t}`);
      candidates.add(`${day.toLowerCase()} ${t}`);
    }
  };
  
  if (diffDays === 1) {
    for (const t of times) {
      candidates.add(`Tomorrow at ${t}`);
      candidates.add(`Tomorrow ${t}`);
      candidates.add(`tomorrow at ${t}`);
      candidates.add(`tomorrow ${t}`);
    }
    addDayVariations(dayName);
    addDayVariations(fullDayName);
  } else if (diffDays === 0) {
    for (const t of times) {
      candidates.add(`Today at ${t}`);
      candidates.add(`Today ${t}`);
      candidates.add(`today at ${t}`);
      candidates.add(`today ${t}`);
    }
    // DAZN shows "This evening" for same-day events at 17:00+
    if (hours >= 17) {
      for (const t of times) {
        candidates.add(`This evening at ${t}`);
        candidates.add(`This evening ${t}`);
        candidates.add(`this evening at ${t}`);
        candidates.add(`this evening ${t}`);
        candidates.add(`Tonight at ${t}`);
        candidates.add(`Tonight ${t}`);
        candidates.add(`tonight at ${t}`);
        candidates.add(`tonight ${t}`);
      }
    }
    addDayVariations(dayName);
    addDayVariations(fullDayName);
  } else if (diffDays > 1 && diffDays <= 7) {
    addDayVariations(dayName);
    addDayVariations(fullDayName);
  } else {
    // Far date
    const dayNum = eventDate.getDate();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fullMonthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    const monthName = monthNames[eventDate.getMonth()];
    const fullMonthName = fullMonthNames[eventDate.getMonth()];
    
    // Ordinal suffix for day number (e.g., 1st, 2nd, 3rd, 25th)
    const getOrdinal = (d: number): string => {
      if (d >= 11 && d <= 13) return 'th';
      switch (d % 10) {
        case 1: return 'st';
        case 2: return 'nd';
        case 3: return 'rd';
        default: return 'th';
      }
    };
    const ordinal = getOrdinal(dayNum);
    
    const formats = [
      `${dayNum} ${monthName}`,
      `${dayNum} ${fullMonthName}`,
      `${dayNum} ${monthName.toUpperCase()}`,
      `${dayNum} ${fullMonthName.toUpperCase()}`,
      // Ordinal variants: "25th Jul", "25th July"
      `${dayNum}${ordinal} ${monthName}`,
      `${dayNum}${ordinal} ${fullMonthName}`,
    ];
    
    // Weekday-prefixed variants: "Sat 25th Jul", "Sat 25 Jul"
    const weekdayPrefixes = [dayName, fullDayName, dayName.toUpperCase(), fullDayName.toUpperCase()];
    for (const prefix of weekdayPrefixes) {
      formats.push(`${prefix} ${dayNum}${ordinal} ${monthName}`);
      formats.push(`${prefix} ${dayNum}${ordinal} ${fullMonthName}`);
      formats.push(`${prefix} ${dayNum} ${monthName}`);
      formats.push(`${prefix} ${dayNum} ${fullMonthName}`);
    }
    
    for (const f of formats) {
      candidates.add(f);
      for (const t of times) {
        candidates.add(`${f} at ${t}`);
        candidates.add(`${f} ${t}`);
      }
    }
  }
  
  return Array.from(candidates).join('|');
}

export function getDynamicDateBadge(configStr: string, referenceDate: Date = getNowIST()): string {
  if (!configStr) return '';
  return configStr.split('|').map(part => getDynamicDateBadgeSingle(part, referenceDate)).join('|');
}