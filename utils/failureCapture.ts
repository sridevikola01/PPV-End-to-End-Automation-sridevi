import fs from 'fs';
import path from 'path';

// ─────────────────────────────────────────────────────────────────
// FAILURE SCREENSHOT CAPTURE
// For each FAILED field on the currently-displayed page, re-locate the
// element by its rendered text, draw a red box around it, and capture a
// screenshot. The screenshot path is attached to the result object so the
// HTML/PDF report can embed it as evidence.
// Must be called while the page is still on the validated screen
// (i.e. before the flow navigates away).
// ─────────────────────────────────────────────────────────────────

const SHOTS_DIR = path.resolve(process.cwd(), 'test-results', 'failure-shots');

// Values that are not real on-screen text and so can't be boxed directly
const NON_TEXT = new Set(['n/a', 'na', 'yes', 'no', 'true', 'false', '', '—']);

function matchCandidates(result: any): string[] {
  const out: string[] = [];
  const push = (raw: unknown) => {
    let s = String(raw ?? '').replace(/​/g, '').replace(/\s+/g, ' ').trim();
    if (!s) return;
    // Configs use "a|b" to list acceptable alternatives — take the first
    if (s.includes('|')) s = s.split('|')[0].trim();
    if (NON_TEXT.has(s.toLowerCase())) return;
    if (s.length < 2) return;

    if (!out.includes(s)) out.push(s);

    // If it contains newlines or punctuation, try pushing parts
    const parts = s.split(/[\n\r\-–—:•]+/).map(p => p.trim()).filter(p => p.length >= 4);
    for (const part of parts) {
      if (!out.includes(part)) out.push(part);
    }

    // Try first 4 words for long strings
    const words = s.split(/\s+/).filter(Boolean);
    if (words.length > 4) {
      const shortPhrase = words.slice(0, 4).join(' ');
      if (!out.includes(shortPhrase) && shortPhrase.length >= 4) {
        out.push(shortPhrase);
      }
    }
  };
  // Prefer the ACTUAL rendered value (it is what's on the page), then expected
  push(result.actual);
  push(result.expected);
  return out;
}

function safeName(s: string): string {
  return String(s || '').replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 50);
}

async function findTarget(page: any, candidates: string[]): Promise<any | null> {
  for (const text of candidates) {
    try {
      const locator = page.getByText(text, { exact: false });
      const count = await locator.count().catch(() => 0);
      for (let i = 0; i < count; i++) {
        const item = locator.nth(i);
        if (await item.isVisible().catch(() => false)) {
          return item;
        }
      }
    } catch { /* try next candidate */ }
  }
  return null;
}

export async function captureFailures(
  page: any,
  results: any[],
  pageName: string
): Promise<void> {
  if (!page || page.isClosed()) return;

  const fails = results.filter(
    (r) => r && r.page === pageName && r.status === 'FAIL' && !r.__shotDone
  );
  if (!fails.length) return;

  if (!fs.existsSync(SHOTS_DIR)) fs.mkdirSync(SHOTS_DIR, { recursive: true });

  for (const r of fails) {
    r.__shotDone = true; // mark so we don't re-capture if called again
    const field = r.field || 'field';
    const file = path.join(
      SHOTS_DIR,
      `${safeName(pageName)}_${safeName(field)}_${Date.now()}.png`
    );

    let handle: any = null;
    try {
      const target = await findTarget(page, matchCandidates(r));

      if (target) {
        console.log(`🎯 [Fail Shot] Highlight target found for field "${field}": "${(await target.textContent().catch(() => '')).trim().substring(0, 50)}"`);
        await target.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => { });
        handle = await target.elementHandle().catch(() => null);
        if (handle) {
          // Draw a red highlight box around the failing element
          await page.evaluate((el: HTMLElement) => {
            (el as any).__prevOutline = el.style.outline;
            (el as any).__prevShadow = el.style.boxShadow;
            (el as any).__prevOffset = el.style.outlineOffset;
            (el as any).__prevBackground = el.style.backgroundColor;
            el.style.setProperty('outline', '4px solid #ff1744', 'important');
            el.style.setProperty('outline-offset', '2px', 'important');
            el.style.setProperty('box-shadow', '0 0 0 4px rgba(255,23,68,0.35)', 'important');
            el.style.setProperty('background-color', 'rgba(255, 23, 68, 0.2)', 'important');
            el.scrollIntoView({ block: 'center', inline: 'center' });
          }, handle).catch(() => { });
          await page.waitForTimeout(150);
        }
      }

      // Remove any overflow:hidden that causes dark/clipped screenshots
      await page.evaluate(() => {
        document.documentElement.style.overflow = '';
        document.body.style.overflow = '';
      }).catch(() => { });
      await page.waitForTimeout(100);
      // Viewport screenshot (element is centered & boxed when found)
      await page.screenshot({ path: file, fullPage: false }).catch(() => { });
      if (fs.existsSync(file)) {
        r.screenshot = file;
        console.log(`📸 [Fail Shot] ${pageName} · ${field} → ${file}`);
      }
    } catch (e: any) {
      console.warn(`⚠️  [Fail Shot] could not capture "${field}": ${e?.message || e}`);
    } finally {
      // Always remove the highlight so later screenshots aren't polluted
      if (handle) {
        await page.evaluate((el: HTMLElement) => {
          el.style.outline = (el as any).__prevOutline || '';
          el.style.boxShadow = (el as any).__prevShadow || '';
          el.style.outlineOffset = (el as any).__prevOffset || '';
          el.style.backgroundColor = (el as any).__prevBackground || '';
        }, handle).catch(() => { });
      }
    }
  }
}
