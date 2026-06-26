import * as fs from 'fs';
import * as path from 'path';
import * as XLSX from 'xlsx';

// ── Configuration ────────────────────────────────────────────────────────────
const REPORTS_DIR = path.resolve(process.cwd(), 'reports');
const OUTPUT_FILE = path.join(REPORTS_DIR, 'Master_Compiled_Results.xlsx');

// Optional Base URL for absolute links (e.g. S3 hosting)
// Can be passed via command line: npm run compile:reports -- https://my-bucket.s3.amazonaws.com/reports/
const baseUrlArg = process.argv.slice(2).find(arg => arg.startsWith('http'));
const BASE_URL = baseUrlArg ? baseUrlArg.replace(/\/$/, '') : null;

console.log('🔍 Starting Report Compilation...');
if (BASE_URL) {
  console.log(`🌐 Using Base URL prefix for links: ${BASE_URL}`);
} else {
  console.log('📂 Generating relative local hyperlinks.');
}

interface CompiledRun {
  timestamp: string;
  region: string;
  source: string;
  tier: string;
  plan: string;
  totalTests: number | string;
  passed: number | string;
  failed: number | string;
  passRate: string;
  htmlLink: { f: string } | string;
  pdfLink: { f: string } | string;
  excelLink: { f: string } | string;
  videoLink: { f: string } | string;
}

function parseFolderName(folderName: string) {
  // Expected structure: REGION_SOURCE_TIER_PLAN_TIMESTAMP
  // E.g. GB_Schedule_DAZN-Standard_Annual-Pay-Monthly_2026-06-17T08-10-46
  const parts = folderName.split('_');
  
  if (parts.length >= 5) {
    const region = parts[0];
    const source = parts[1].replace(/-/g, ' ');
    const tier = parts[2].replace(/-/g, ' ');
    const plan = parts[3].replace(/-/g, ' ');
    // Join remaining parts in case timestamp contains underscores
    const timestampRaw = parts.slice(4).join('_');
    
    // Make timestamp look clean: YYYY-MM-DD HH:MM:SS
    // 2026-06-17T08-10-46 -> 2026-06-17 08:10:46
    const timestamp = timestampRaw
      .replace('T', ' ')
      .replace(/-/g, ':')
      .replace(/^(\d{4}:\d{2}:\d{2})/, (_, datePart) => datePart.replace(/:/g, '-'));

    return { region, source, tier, plan, timestamp };
  }

  // Fallback for non-standard folder names
  return {
    region: 'N/A',
    source: 'N/A',
    tier: 'N/A',
    plan: 'N/A',
    timestamp: folderName
  };
}

function makeHyperlink(folderName: string, fileName: string, friendlyName: string) {
  const relativePath = `./${folderName}/${fileName}`;
  const target = BASE_URL ? `${BASE_URL}/${folderName}/${fileName}` : relativePath;
  return { f: `HYPERLINK("${target}", "${friendlyName}")` };
}

async function compile() {
  if (!fs.existsSync(REPORTS_DIR)) {
    console.error(`❌ Reports directory not found at: ${REPORTS_DIR}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(REPORTS_DIR, { withFileTypes: true });
  const runFolders = entries
    .filter(e => e.isDirectory() && e.name !== 'Master_Compiled_Results')
    .map(e => e.name);

  if (runFolders.length === 0) {
    console.log('⚠️  No run report directories found.');
    process.exit(0);
  }

  console.log(`📂 Found ${runFolders.length} run directory/directories. Processing...`);

  const compiledRows: CompiledRun[] = [];

  for (const folder of runFolders) {
    const folderPath = path.join(REPORTS_DIR, folder);
    const { region, source, tier, plan, timestamp } = parseFolderName(folder);

    let totalTests: number | string = 'N/A';
    let passed: number | string = 'N/A';
    let failed: number | string = 'N/A';
    let passRate = 'N/A';

    // 1. Try to read metrics from PPV_Results.xlsx
    const excelPath = path.join(folderPath, 'PPV_Results.xlsx');
    if (fs.existsSync(excelPath)) {
      try {
        const workbook = XLSX.readFile(excelPath);
        const summarySheet = workbook.Sheets['Summary'];
        if (summarySheet) {
          const summaryData: any[] = XLSX.utils.sheet_to_json(summarySheet);
          for (const row of summaryData) {
            const metric = String(row.Metric || '').trim();
            const value = row.Value;
            if (metric === 'Total Tests') totalTests = Number(value);
            else if (metric === 'Passed') passed = Number(value);
            else if (metric === 'Failed') failed = Number(value);
            else if (metric === 'Pass Rate') passRate = String(value);
          }
        }
      } catch (err) {
        console.warn(`⚠️  Could not read summary sheet from excel in folder: ${folder}. Error: ${err}`);
      }
    }

    // 2. Identify report files
    let htmlFile = '';
    let pdfFile = '';
    let excelFile = '';
    let videoFile = '';

    const files = fs.readdirSync(folderPath);
    for (const file of files) {
      if (file.toLowerCase() === 'ppv_report.html') htmlFile = file;
      else if (file.toLowerCase() === 'ppv_report.pdf') pdfFile = file;
      else if (file.toLowerCase() === 'ppv_results.xlsx' || file.toLowerCase().endsWith('.xlsx')) excelFile = file;
      else if (file.toLowerCase() === 'ppv_video.webm' || file.toLowerCase().endsWith('.webm') || file.toLowerCase().endsWith('.mp4')) videoFile = file;
    }

    // 3. Build hyperlinks
    const htmlLink = htmlFile ? makeHyperlink(folder, htmlFile, 'HTML') : 'N/A';
    const pdfLink = pdfFile ? makeHyperlink(folder, pdfFile, 'PDF') : 'N/A';
    const excelLink = excelFile ? makeHyperlink(folder, excelFile, 'Excel') : 'N/A';
    const videoLink = videoFile ? makeHyperlink(folder, videoFile, 'Video') : 'N/A';

    compiledRows.push({
      timestamp,
      region,
      source,
      tier,
      plan,
      totalTests,
      passed,
      failed,
      passRate,
      htmlLink,
      pdfLink,
      excelLink,
      videoLink
    });
  }

  // Sort rows chronologically (latest first)
  compiledRows.sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  // ── Build Workbook ─────────────────────────────────────────────────────────
  const wb = XLSX.utils.book_new();

  // Map fields to final column layout (pass string placeholders first)
  const excelRows = compiledRows.map(row => ({
    'Run Timestamp': row.timestamp,
    'Region': row.region,
    'Surfacing Point': row.source,
    'DAZN Tier': row.tier,
    'Rate Plan': row.plan,
    'Total Assertions': row.totalTests,
    'Passed': row.passed,
    'Failed': row.failed,
    'Pass Rate': row.passRate,
    'HTML Report': typeof row.htmlLink === 'object' ? 'HTML' : 'N/A',
    'PDF Report': typeof row.pdfLink === 'object' ? 'PDF' : 'N/A',
    'Excel Data': typeof row.excelLink === 'object' ? 'Excel' : 'N/A',
    'Video Recording': typeof row.videoLink === 'object' ? 'Video' : 'N/A'
  }));

  const headers = [
    'Run Timestamp',
    'Region',
    'Surfacing Point',
    'DAZN Tier',
    'Rate Plan',
    'Total Assertions',
    'Passed',
    'Failed',
    'Pass Rate',
    'HTML Report',
    'PDF Report',
    'Excel Data',
    'Video Recording'
  ];

  const ws = XLSX.utils.json_to_sheet(excelRows, { header: headers });

  // Post-process the worksheet to inject formulas and make them clickable
  compiledRows.forEach((row, index) => {
    const rowIndex = index + 2; // 1-indexed, +1 for header
    
    if (typeof row.htmlLink === 'object') {
      const cellAddr = `J${rowIndex}`;
      ws[cellAddr] = { t: 's', v: 'HTML', f: row.htmlLink.f };
    }
    if (typeof row.pdfLink === 'object') {
      const cellAddr = `K${rowIndex}`;
      ws[cellAddr] = { t: 's', v: 'PDF', f: row.pdfLink.f };
    }
    if (typeof row.excelLink === 'object') {
      const cellAddr = `L${rowIndex}`;
      ws[cellAddr] = { t: 's', v: 'Excel', f: row.excelLink.f };
    }
    if (typeof row.videoLink === 'object') {
      const cellAddr = `M${rowIndex}`;
      ws[cellAddr] = { t: 's', v: 'Video', f: row.videoLink.f };
    }
  });

  // Format Column Widths dynamically
  const colWidths = headers.map(header => {
    let maxLen = header.length;
    for (const r of excelRows as any[]) {
      const val = r[header];
      const strLen = String(val ?? '').length;
      maxLen = Math.max(maxLen, strLen);
    }
    return { wch: maxLen + 4 };
  });
  ws['!cols'] = colWidths;

  XLSX.utils.book_append_sheet(wb, ws, 'PPV Automation Runs');

  // Write file
  XLSX.writeFile(wb, OUTPUT_FILE, { bookType: 'xlsx', type: 'binary' });

  console.log(`\n✅ Success! Compiled report saved to: ${OUTPUT_FILE}`);
  console.log(`📊 Master spreadsheet contains summary of ${compiledRows.length} test run(s).`);
}

compile().catch(err => {
  console.error('❌ Compilation Failed:', err);
  process.exit(1);
});
