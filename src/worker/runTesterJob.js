#!/usr/bin/env node

/**
 * CLI Entrypoint for GitHub Actions (or containerized) Playwright Runner
 * Reads: TEST_ID, USER_ID, TARGET_URL, CALLBACK_URL, TESTER_WORKER_SECRET from env
 */

const { executePlaywrightPipeline, postWebhook } = require('./testerCore');

async function main() {
  const testId = process.env.TEST_ID || process.argv[2];
  const userId = process.env.USER_ID || process.argv[3];
  const targetUrl = process.env.TARGET_URL || process.argv[4];
  const callbackUrl = process.env.CALLBACK_URL || process.argv[5];

  console.log('=== Bob Autonomous Website Tester — GitHub Actions Runner ===');
  console.log(`Test ID:      ${testId}`);
  console.log(`User ID:      ${userId}`);
  console.log(`Target URL:   ${targetUrl}`);
  console.log(`Callback URL: ${callbackUrl}`);

  if (!testId || !userId || !targetUrl || !callbackUrl) {
    console.error('Fatal Error: Missing required environment variables (TEST_ID, USER_ID, TARGET_URL, CALLBACK_URL)');
    process.exit(1);
  }

  // Step A: Pull authConfig securely over HTTPS via zero-leak worker_ready event
  let authConfig = { mode: 'guest' };
  try {
    console.log('[runTesterJob] Posting "worker_ready" to retrieve one-time authConfig over HTTPS...');
    const readyRes = await postWebhook(callbackUrl, {
      event: 'worker_ready',
      testId,
      userId
    }, 2);

    if (readyRes && readyRes.authConfig) {
      authConfig = readyRes.authConfig;
      console.log(`[runTesterJob] Received authConfig successfully (Mode: "${authConfig.mode || 'guest'}").`);
    } else {
      console.log('[runTesterJob] No authConfig returned; proceeding in guest mode.');
    }
  } catch (readyErr) {
    console.warn('[runTesterJob] Warning: Failed to fetch authConfig via worker_ready, falling back to guest mode:', readyErr.message);
  }

  // Step B: Run the complete Playwright pipeline
  try {
    console.log('[runTesterJob] Launching Playwright pipeline...');
    await executePlaywrightPipeline({
      testId,
      userId,
      url: targetUrl,
      callbackUrl,
      authConfig
    });

    console.log('[runTesterJob] Playwright audit job completed successfully.');
    process.exit(0);
  } catch (err) {
    console.error('[runTesterJob] Fatal execution failure:', err);
    process.exit(1);
  }
}

main().catch((fatal) => {
  console.error('[runTesterJob] Unhandled top-level exception:', fatal);
  process.exit(1);
});
