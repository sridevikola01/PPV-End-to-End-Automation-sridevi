import fs from 'fs';
import path from 'path';
import { chromium } from '@playwright/test';

// ─────────────────────────────────────────────────────────────────
// HTML + PDF RUN REPORT GENERATOR
// Produces an easy-to-read run report showing:
//   • which country / surfacing point / rate plan was used
//   • per-page pass & fail counts
//   • total pass & fail
// Styled to be understandable at a glance for everyone.
// ─────────────────────────────────────────────────────────────────

export interface ReportResult {
  page: string;
  field: string;
  expected: unknown;
  actual: unknown;
  status: 'PASS' | 'FAIL';
  screenshot?: string; // absolute path to a red-boxed failure screenshot
}

export interface ReportMeta {
  event: string;        // e.g. "Beauty and The Beast: Fury vs. Hall"
  region: string;       // country, e.g. "GB"
  source: string;       // surfacing point, e.g. "landing-page-banner"
  ratePlan: string;     // rate plan clicked, e.g. "monthly"
  tier: string;         // e.g. "standard"
  env: string;          // e.g. "prod"
  flowName: string;     // e.g. "Landing Page Banner → Standard → Flex Monthly"
  startTime?: Date;
  endTime?: Date;
  videoPath?: string | null;
  excelPath?: string | null;
  userType?: 'new-user' | 'existing-user';
}

function inlineImage(p?: string): string | null {
  try {
    if (!p || !fs.existsSync(p)) return null;
    const b64 = fs.readFileSync(p).toString('base64');
    return `data:image/png;base64,${b64}`;
  } catch {
    return null;
  }
}

function esc(v: unknown): string {
  return String(v ?? '')
    .replace(/&amp;/g, '&')   // unescape already-escaped
    .replace(/&apos;/g, "'")  // unescape apostrophes
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pageIcon(page: string): string {
  const p = page.toLowerCase();
  if (p.includes('schedule')) return '📅';
  if (p.includes('landing')) return '🏠';
  if (p.includes('ppv')) return '🥊';
  if (p.includes('plan')) return '📋';
  if (p.includes('payment')) return '💳';
  if (p.includes('otp')) return '🔑';
  if (p.includes('phone')) return '📱';
  if (p.includes('search')) return '🔎';
  if (p.includes('home')) return '🏟️';
  return '📄';
}

function prettySource(src: string): string {
  return (src || '')
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function prettyPlan(ratePlan: string, tier: string): string {
  const rp = (ratePlan || '').toLowerCase();
  const t = tier ? tier.charAt(0).toUpperCase() + tier.slice(1) : '';
  let plan = ratePlan || '';
  if (rp === 'monthly') plan = 'Flex – Pay Monthly';
  else if (rp.includes('upfront')) plan = 'Annual – Pay Upfront';
  else if (rp.includes('annual')) plan = 'Annual – Pay Monthly';
  return t ? `${t} · ${plan}` : plan;
}

function fmtDuration(ms: number): string {
  if (!ms || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  const m = Math.floor(s / 60);
  const r = s % 60;
  return m > 0 ? `${m}m ${r}s` : `${r}s`;
}

function buildHtml(results: ReportResult[], meta: ReportMeta): string {
  // Filter out rows where both expected and actual are N/A — these are non-applicable fields
  results = results.filter(r => {
    const expNA = String(r.expected ?? '').trim().toUpperCase() === 'N/A';
    const actNA = String(r.actual ?? '').trim().toUpperCase() === 'N/A';
    return !(expNA && actNA);
  });

  const pages = [...new Set(results.map(r => r.page))];
  const totalPass = results.filter(r => r.status === 'PASS').length;
  const totalFail = results.filter(r => r.status === 'FAIL').length;
  const total = results.length;
  const passPct = total ? Math.round((totalPass / total) * 100) : 0;

  const now = meta.endTime || new Date();
  const dur = meta.startTime ? now.getTime() - meta.startTime.getTime() : 0;

  // Donut: conic-gradient with pass(green)/fail(red)
  const passDeg = total ? (totalPass / total) * 360 : 0;
  const donut = `conic-gradient(#16a34a 0deg ${passDeg}deg, #dc2626 ${passDeg}deg 360deg)`;

  const overallBadge = totalFail === 0
    ? `<span class="pill pill-pass">ALL PASSED</span>`
    : `<span class="pill pill-fail">${totalFail} FAILED</span>`;

  // ── Per-page summary rows with stacked bar ──
  const pageRows = pages.map(p => {
    const pr = results.filter(r => r.page === p);
    const pass = pr.filter(r => r.status === 'PASS').length;
    const fail = pr.filter(r => r.status === 'FAIL').length;
    const tot = pr.length;
    const pPct = tot ? (pass / tot) * 100 : 0;
    const fPct = 100 - pPct;
    return `
      <tr>
        <td class="page-name">${pageIcon(p)}&nbsp; ${esc(p)}</td>
        <td class="num pass-txt">${pass}</td>
        <td class="num fail-txt">${fail}</td>
        <td class="num">${tot}</td>
        <td>
          <div class="bar">
            <div class="bar-pass" style="width:${pPct}%"></div>
            <div class="bar-fail" style="width:${fPct}%"></div>
          </div>
        </td>
        <td class="num">${tot ? Math.round(pPct) : 0}%</td>
      </tr>`;
  }).join('');

  // ── Detailed results grouped by page ──
  const detailBlocks = pages.map(p => {
    const pr = results.filter(r => r.page === p);
    const rows = pr.map(r => {
      const cls = r.status === 'PASS' ? 'st-pass' : 'st-fail';
      const hasExpected = r.expected !== undefined && r.expected !== null && String(r.expected) !== '';
      const hasActual = r.actual !== undefined && r.actual !== null && String(r.actual) !== '';
      const showVals = hasExpected || hasActual;
      const img = r.status === 'FAIL' ? inlineImage(r.screenshot) : null;
      const shotRow = img
        ? `
        <tr class="shot-row">
          <td colspan="4">
            <img class="shot" src="${img}" alt="Screenshot for ${esc(r.field)}"/>
          </td>
        </tr>`
        : '';
      return `
        <tr class="${r.status === 'FAIL' ? 'row-fail' : ''}">
          <td>${esc(r.field)}</td>
          <td class="vcell">${showVals ? esc(r.expected) : '<span class="muted">—</span>'}</td>
          <td class="vcell">${showVals ? esc(r.actual) : '<span class="muted">—</span>'}</td>
          <td><span class="status ${cls}">${r.status}</span></td>
        </tr>${shotRow}`;
    }).join('');
    const pass = pr.filter(r => r.status === 'PASS').length;
    const fail = pr.filter(r => r.status === 'FAIL').length;
    return `
      <div class="page-block">
        <div class="page-block-head">
          ${pageIcon(p)}&nbsp; <span>${esc(p)}</span>
          <span class="page-block-counts">
            <span class="pass-txt">✓ ${pass}</span>
            <span class="fail-txt">✕ ${fail}</span>
          </span>
        </div>
        <table class="detail">
          <thead><tr><th>Check</th><th>Expected</th><th>Actual</th><th>Status</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  const fmtTime = (d?: Date) => d ? d.toLocaleString('en-GB') : '—';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>DAZN PPV Run Report</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         margin: 0; background: #f1f5f9; color: #0f172a; font-size: 13px; }
  .wrap { max-width: 960px; margin: 0 auto; padding: 28px 24px 48px; }
  @media print {
    .wrap { max-width: 100%; padding: 8px; }
    .shot { max-height: 280px; width: auto; }
    .bar { min-width: 60px; }
    .cards { flex-wrap: nowrap; }
    .card { min-width: 60px; padding: 8px 10px; }
    .top { flex-wrap: nowrap; }
    .meta-grid { grid-template-columns: repeat(3, 1fr); }
  }
  h1 { font-size: 22px; margin: 0 0 4px; color: #0b1f3a; }
  .sub { color: #64748b; font-size: 12px; margin-bottom: 22px; }
  h2 { font-size: 15px; margin: 28px 0 12px; color: #0b1f3a; border-bottom: 2px solid #e2e8f0; padding-bottom: 6px; }

  .top { display: flex; gap: 24px; align-items: flex-start; flex-wrap: nowrap; }
  .donut { width: 132px; height: 132px; border-radius: 50%; background: ${donut};
           display: flex; align-items: center; justify-content: center; flex: 0 0 auto; }
  .donut .hole { width: 92px; height: 92px; border-radius: 50%; background: #fff;
                 display: flex; flex-direction: column; align-items: center; justify-content: center; }
  .donut .hole .big { font-size: 26px; font-weight: 700; color: #0b1f3a; line-height: 1; }
  .donut .hole .lbl { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: .5px; margin-top: 2px; }

  .cards { display: flex; gap: 12px; flex-wrap: nowrap; align-items: stretch; }
  .card { background: #fff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px 16px; min-width: 80px; max-width: 110px; text-align: center;
          box-shadow: 0 1px 2px rgba(0,0,0,.04); flex: 1; }
  .card .v { font-size: 24px; font-weight: 700; line-height: 1; }
  .card .k { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: .6px; margin-top: 6px; }
  .card.pass .v { color: #16a34a; } .card.fail .v { color: #dc2626; } .card.pct .v { color: #2563eb; }

  .pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: .4px; }
  .pill-pass { background: #dcfce7; color: #15803d; } .pill-fail { background: #fee2e2; color: #b91c1c; }

  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden;
          box-shadow: 0 1px 2px rgba(0,0,0,.04); }
  th { background: #0b1f3a; color: #fff; text-align: left; padding: 9px 12px; font-size: 11px; text-transform: uppercase; letter-spacing: .5px; white-space: nowrap; }
  td { padding: 8px 12px; border-top: 1px solid #eef2f7; vertical-align: middle; }
  table.detail th:nth-child(1) { width: 35%; }
  table.detail th:nth-child(2) { width: 28%; }
  table.detail th:nth-child(3) { width: 28%; }
  table.detail th:nth-child(4) { width: 9%; text-align: center; }
  table.detail td:nth-child(4) { text-align: center; }
  .num { text-align: center; font-variant-numeric: tabular-nums; font-weight: 600; }
  .pass-txt { color: #16a34a; } .fail-txt { color: #dc2626; }
  .page-name { font-weight: 600; }

  .bar { height: 10px; border-radius: 5px; background: #e2e8f0; overflow: hidden; display: flex; min-width: 160px; }
  .bar-pass { background: #16a34a; height: 100%; } .bar-fail { background: #dc2626; height: 100%; }

  .meta-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
  .meta-item { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 11px 14px; }
  .meta-item .k { font-size: 10px; color: #64748b; text-transform: uppercase; letter-spacing: .6px; }
  .meta-item .v { font-size: 13px; font-weight: 600; margin-top: 3px; color: #0b1f3a; word-break: break-word; white-space: normal; }

  .page-block { margin-bottom: 18px; }
  .page-block-head { background: #e8eef6; color: #0b1f3a; font-weight: 700; padding: 8px 12px; border-radius: 8px 8px 0 0;
                     display: flex; align-items: center; font-size: 13px; }
  .page-block-counts { margin-left: auto; display: flex; gap: 14px; font-size: 12px; }
  table.detail { border-radius: 0 0 8px 8px; }
  .vcell { font-size: 12px; color: #334155; max-width: 360px; }
  .muted { color: #cbd5e1; }
  .row-fail { background: #fff7f7; }
  .status { display: inline-block; padding: 2px 9px; border-radius: 5px; font-size: 11px; font-weight: 700; white-space: nowrap; }
  .st-pass { background: #dcfce7; color: #15803d; } .st-fail { background: #fee2e2; color: #b91c1c; }
  .foot { margin-top: 30px; color: #94a3b8; font-size: 11px; text-align: center; }
  .shot-row td { padding: 4px 12px 12px; background: #fff7f7; }
  .shot-label { font-size: 11px; color: #dc2626; font-weight: 600; margin-bottom: 6px; }
  .shot { max-width: 100%; width: auto; max-height: 480px; object-fit: contain; border-radius: 6px; 
          margin-top: 4px; border: 2px solid #fca5a5; display: block; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>DAZN PPV ${(meta.userType === 'existing-user') ? 'Existing-User' : 'New-User'} Run Report</h1>
    <div class="sub">
      Generated: ${fmtTime(now)} &nbsp;|&nbsp; Start: ${fmtTime(meta.startTime)} &nbsp;|&nbsp; Duration: ${fmtDuration(dur)} &nbsp;|&nbsp; ${overallBadge}
    </div>

    <h2>Execution Summary</h2>
    <div class="top">
      <div class="donut"><div class="hole"><span class="big">${total}</span><span class="lbl">checks</span></div></div>
      <div class="cards">
        <div class="card"><div class="v">${pages.length}</div><div class="k">Pages</div></div>
        <div class="card"><div class="v">${total}</div><div class="k">Total Checks</div></div>
        <div class="card pass"><div class="v">${totalPass}</div><div class="k">Passed</div></div>
        <div class="card fail"><div class="v">${totalFail}</div><div class="k">Failed</div></div>
        <div class="card pct"><div class="v">${passPct}%</div><div class="k">Pass Rate</div></div>
      </div>
    </div>

    <h2>Run Configuration</h2>
    <div class="meta-grid">
      <div class="meta-item"><div class="k">Country / Region</div><div class="v">🌍 ${esc(meta.region)}</div></div>
      <div class="meta-item"><div class="k">Surfacing Point</div><div class="v">📍 ${esc(prettySource(meta.source))}</div></div>
      <div class="meta-item"><div class="k">Rate Plan Clicked</div><div class="v">💳 ${esc(prettyPlan(meta.ratePlan, meta.tier))}</div></div>
      <div class="meta-item"><div class="k">Event</div><div class="v">🥊 ${esc(meta.event)}</div></div>
      <div class="meta-item"><div class="k">Environment</div><div class="v">🧭 ${esc((meta.env || '').toUpperCase())}</div></div>
      <div class="meta-item"><div class="k">Flow</div><div class="v">${esc(meta.flowName)}</div></div>
    </div>

    <h2>Per-Page Results</h2>
    <table>
      <thead><tr><th>Page</th><th class="num">Pass</th><th class="num">Fail</th><th class="num">Total</th><th>Progress</th><th class="num">Pass %</th></tr></thead>
      <tbody>
        ${pageRows}
        <tr style="background:#f8fafc; font-weight:700;">
          <td class="page-name">Σ&nbsp; TOTAL</td>
          <td class="num pass-txt">${totalPass}</td>
          <td class="num fail-txt">${totalFail}</td>
          <td class="num">${total}</td>
          <td><div class="bar"><div class="bar-pass" style="width:${passPct}%"></div><div class="bar-fail" style="width:${100 - passPct}%"></div></div></td>
          <td class="num">${passPct}%</td>
        </tr>
      </tbody>
    </table>

    <h2>Detailed Results</h2>
    ${detailBlocks}

    <div class="foot">DAZN automated PPV test • ${esc(meta.flowName)} • ${fmtTime(now)}</div>
  </div>
</body>
</html>`;
}

export async function generateReports(
  results: ReportResult[],
  meta: ReportMeta
): Promise<{ htmlPath: string | null; pdfPath: string | null }> {
  if (!results.length) {
    console.warn('⚠️  [Report] No results — skipping report generation');
    return { htmlPath: null, pdfPath: null };
  }

  const reportsDir = path.resolve(process.cwd(), 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = `${meta.region}_${meta.source}_${meta.tier}_${meta.ratePlan}`
    .replace(/[^a-zA-Z0-9_-]/g, '-');
  const base = path.join(reportsDir, `PPV_${slug}_${stamp}`);
  const htmlPath = `${base}.html`;
  const pdfPath = `${base}.pdf`;

  const html = buildHtml(results, meta);
  fs.writeFileSync(htmlPath, html, 'utf-8');

  // Render PDF via headless Chrome (channel:chrome avoids needing bundled chromium)
  let pdfOk = false;
  try {
    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto('file://' + htmlPath, { waitUntil: 'load' });
    await page.pdf({
      path: pdfPath,
      format: 'A4',
      landscape: false,
      printBackground: true,
      margin: { top: '10mm', bottom: '10mm', left: '8mm', right: '8mm' },
    });
    await browser.close();
    pdfOk = true;
  } catch (e: any) {
    // PDF generation failed silently — HTML report still available
  }

  return { htmlPath, pdfPath: pdfOk ? pdfPath : null };
}
