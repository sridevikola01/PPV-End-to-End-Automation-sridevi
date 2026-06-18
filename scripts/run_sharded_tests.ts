import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// Predefined defaults
const DEFAULT_SOURCES = [
  'home-page-get-started',
  'landing-page-banner',
  'landing-page-dont-miss-live',
  'boxing-page-banner',
  'boxing-page-bundle',
  'boxing-upcoming-fights',
  'home-boxing-banner',
  'home-boxing-tile',
  'home-boxing-upcoming',
  'search',
  'schedule',
  'home-kickboxing-tile',
  'home-page-banner',
  'home-page-dont-miss',
  'home-biggest-fights'
];

const DEFAULT_PLANS = [
  'standard_monthly',
  'standard_apm',
  'ultimate_apm',
  'ultimate_upfront'
];

// Helper to parse CLI arguments
function parseArgs() {
  const args = process.argv.slice(2);
  const options: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const parts = arg.slice(2).split('=');
      const key = parts[0];
      const val = parts[1] !== undefined ? parts[1] : true;
      options[key] = val;
    }
  }
  return options;
}

async function main() {
  const options = parseArgs();

  // Parse shard parameter e.g., --shard=1/4 or use env variables
  const shardStr = (options.shard as string) || process.env.SHARD || '1/1';
  const [shardIndexStr, shardTotalStr] = shardStr.split('/');
  const shardIndex = parseInt(shardIndexStr, 10) || 1;
  const shardTotal = parseInt(shardTotalStr, 10) || 1;

  // Parse lists of plans and sources
  const plansStr = (options.plans as string) || process.env.PLANS || '';
  const plans = plansStr ? plansStr.split(',') : DEFAULT_PLANS;

  const sourcesStr = (options.sources as string) || process.env.SOURCES || '';
  const sources = sourcesStr ? sourcesStr.split(',') : DEFAULT_SOURCES;

  const env = (options.env as string) || process.env.DAZN_ENV || 'prod';
  const region = (options.region as string) || process.env.DAZN_REGION || 'GB';
  const event = (options.event as string) || process.env.PPV_EVENT || 'aj_joshua_prenga';
  const spec = (options.spec as string) || process.env.SPEC || 'tests/new_user/newuser.ppv.spec.ts';
  const dryRun = !!options['dry-run'];
  const headed = !!options.headed || process.env.HEADED === 'true';
  const concurrency = options.concurrency ? parseInt(options.concurrency as string, 10) : plans.length;

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🤖 DAZN Parallel Test Runner');
  console.log(`🌍 Shard:       ${shardIndex} of ${shardTotal}`);
  console.log(`🌐 Env:         ${env}`);
  console.log(`📍 Region:      ${region}`);
  console.log(`🎫 Event:       ${event}`);
  console.log(`📋 Spec:        ${spec}`);
  console.log(`⚙️ Concurrency: ${concurrency} workers`);
  console.log(`🖥️ Headed:      ${headed}`);
  console.log(`🧪 Dry Run:     ${dryRun}`);
  console.log('═══════════════════════════════════════════════════════════════');

  // Build all test combinations
  const combinations: Array<{ plan: string; source: string }> = [];
  for (const plan of plans) {
    for (const source of sources) {
      combinations.push({ plan, source });
    }
  }

  // Filter combinations for the current shard
  const shardTasks = combinations.filter((_, idx) => (idx % shardTotal) === (shardIndex - 1));

  console.log(`📊 Total Combinations: ${combinations.length}`);
  console.log(`👉 Shard Combinations: ${shardTasks.length}`);
  console.log('═══════════════════════════════════════════════════════════════\n');

  if (shardTasks.length === 0) {
    console.log('ℹ️ No tasks assigned to this shard.');
    process.exit(0);
  }

  // Ensure log directory exists
  const logsDir = path.resolve(process.cwd(), 'reports', 'logs');
  if (!dryRun && !fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
  }

  let completed = 0;
  let passed = 0;
  let failed = 0;
  const failures: Array<{ plan: string; source: string; code: number | null; logFile: string }> = [];

  const runTask = async (task: { plan: string; source: string }) => {
    const taskId = `${task.plan}_${task.source}`;
    const logFile = path.join(logsDir, `${taskId}.log`);
    const startTime = Date.now();

    console.log(`▶️  [START] PLAN=${task.plan} | SOURCE=${task.source}`);

    if (dryRun) {
      // Fake delay for dry run visual
      await new Promise(r => setTimeout(r, 500));
      console.log(`✅ [PASS]  PLAN=${task.plan} | SOURCE=${task.source} (Dry Run)`);
      completed++;
      passed++;
      return;
    }

    return new Promise<void>((resolve) => {
      // Prepare environment
      const childEnv = {
        ...process.env,
        DAZN_ENV: env,
        DAZN_REGION: region,
        PPV_EVENT: event,
        PLAN: task.plan,
        SOURCE: task.source,
        CI: 'true',
        HEADLESS: headed ? 'false' : 'true',
      };

      // Spawn Playwright process
      const testArgs = ['playwright', 'test', spec, '--workers=1'];
      if (headed) {
        testArgs.push('--headed');
      }
      const child = spawn('npx', testArgs, {
        env: childEnv,
        shell: true,
      });

      const writeStream = fs.createWriteStream(logFile);
      child.stdout.pipe(writeStream);
      child.stderr.pipe(writeStream);

      child.on('close', (code) => {
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        completed++;

        if (code === 0) {
          passed++;
          console.log(`✅ [PASS]  PLAN=${task.plan} | SOURCE=${task.source} (${duration}s)`);
        } else {
          failed++;
          failures.push({ ...task, code, logFile });
          console.error(`❌ [FAIL]  PLAN=${task.plan} | SOURCE=${task.source} (${duration}s) -- Log: ${logFile}`);
        }
        resolve();
      });
    });
  };

  // Run with concurrency limit
  const active: Promise<void>[] = [];
  for (const task of shardTasks) {
    const p = runTask(task).then(() => {
      active.splice(active.indexOf(p), 1);
    });
    active.push(p);

    if (active.length >= concurrency) {
      await Promise.race(active);
    }
  }
  await Promise.all(active);

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('📊 Shard Run Summary:');
  console.log(`   Total Completed: ${completed}`);
  console.log(`   ✅ Passed:        ${passed}`);
  console.log(`   ❌ Failed:        ${failed}`);
  console.log('═══════════════════════════════════════════════════════════════');

  if (failures.length > 0) {
    console.log('\n❌ Failed Configurations:');
    for (const f of failures) {
      console.log(`   • PLAN=${f.plan} | SOURCE=${f.source} (Exit Code: ${f.code})`);
      console.log(`     Log: ${f.logFile}`);
    }
    console.log('═══════════════════════════════════════════════════════════════\n');
    process.exit(1);
  } else {
    console.log('\n✅ All tests in this shard passed successfully!\n');
    process.exit(0);
  }
}

main().catch(err => {
  console.error('Fatal error in test runner orchestrator:', err);
  process.exit(1);
});
