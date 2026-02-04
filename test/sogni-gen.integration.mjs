import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import JSON5 from 'json5';

const originalSetInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => {
  const handle = originalSetInterval(...args);
  if (handle?.unref) handle.unref();
  return handle;
};

let SogniClientWrapper;
async function getSogniClientWrapper() {
  if (!SogniClientWrapper) {
    ({ SogniClientWrapper } = await import('@sogni-ai/sogni-client-wrapper'));
  }
  return SogniClientWrapper;
}

const integrationFlag = process.env.SOGNI_INTEGRATION;
const shouldRun = integrationFlag === undefined
  ? true
  : ['1', 'true', 'yes'].includes(integrationFlag.toLowerCase());
const credentialsPath = join(homedir(), '.config', 'sogni', 'credentials');
const openclawConfigPath = process.env.OPENCLAW_CONFIG_PATH || join(homedir(), '.openclaw', 'openclaw.json');
const hasCreds = Boolean(process.env.SOGNI_USERNAME && process.env.SOGNI_PASSWORD) || existsSync(credentialsPath);

const IMAGE_TIMEOUT_SEC = Number(process.env.SOGNI_INTEGRATION_IMAGE_TIMEOUT_SEC || 60);
const VIDEO_TIMEOUT_SEC = Number(process.env.SOGNI_INTEGRATION_VIDEO_TIMEOUT_SEC || 600);
const PROCESS_TIMEOUT_MS = Math.max(IMAGE_TIMEOUT_SEC, VIDEO_TIMEOUT_SEC) * 1000 + 120000;

const TESTS = [
  { key: 't2i', name: 'Text-to-image 512x512' },
  { key: 't2v', name: 'Text-to-video 512x512' },
  { key: 'i2v', name: 'Image-to-video 512x512' }
];

const VIDEO_WORKFLOW_DEFAULT_MODELS = {
  t2v: 'wan_v2.2-14b-fp8_t2v_lightx2v',
  i2v: 'wan_v2.2-14b-fp8_i2v_lightx2v',
  s2v: 'wan_v2.2-14b-fp8_s2v_lightx2v',
  'animate-move': 'wan_v2.2-14b-fp8_animate-move_lightx2v',
  'animate-replace': 'wan_v2.2-14b-fp8_animate-replace_lightx2v'
};

function loadOpenClawPluginConfig() {
  if (process.env.OPENCLAW_PLUGIN_CONFIG) {
    try {
      return JSON5.parse(process.env.OPENCLAW_PLUGIN_CONFIG);
    } catch (err) {
      return null;
    }
  }
  if (!existsSync(openclawConfigPath)) return null;
  try {
    const raw = readFileSync(openclawConfigPath, 'utf8');
    const parsed = JSON5.parse(raw);
    return parsed?.plugins?.entries?.['sogni-gen']?.config || null;
  } catch (err) {
    return null;
  }
}

const openclawConfig = loadOpenClawPluginConfig();
const defaultTokenType = (openclawConfig?.defaultTokenType || 'spark').toLowerCase();

function loadCredentials() {
  if (process.env.SOGNI_USERNAME && process.env.SOGNI_PASSWORD) {
    return {
      username: process.env.SOGNI_USERNAME,
      password: process.env.SOGNI_PASSWORD
    };
  }
  if (!existsSync(credentialsPath)) return null;
  const content = readFileSync(credentialsPath, 'utf8');
  const creds = {};
  for (const line of content.split('\n')) {
    const [key, value] = line.split('=');
    if (key && value) creds[key.trim()] = value.trim();
  }
  if (!creds.SOGNI_USERNAME || !creds.SOGNI_PASSWORD) return null;
  return {
    username: creds.SOGNI_USERNAME,
    password: creds.SOGNI_PASSWORD
  };
}

function formatNumber(value) {
  if (!Number.isFinite(value)) return '0';
  return value.toFixed(2);
}

function resolveVideoModel(workflow) {
  if (!workflow) return null;
  return openclawConfig?.videoModels?.[workflow] || VIDEO_WORKFLOW_DEFAULT_MODELS[workflow] || null;
}

function inferDefaultVideoSteps(modelId) {
  const id = (modelId || '').toLowerCase();
  if (id.includes('lightx2v')) return 4;
  if (id.includes('lightning') || id.includes('turbo') || id.includes('lcm')) return 4;
  return 20;
}

function resolveVideoSteps(modelId, modelDefaults, explicitSteps) {
  if (Number.isFinite(explicitSteps)) return explicitSteps;
  if (Number.isFinite(modelDefaults?.steps)) return modelDefaults.steps;
  return inferDefaultVideoSteps(modelId);
}

function parseCostEstimate(estimate, tokenType) {
  if (!estimate) return null;
  const raw = tokenType === 'sogni'
    ? estimate.sogni ?? estimate.token
    : estimate.spark ?? estimate.token;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function renderStatus(statuses) {
  return TESTS.map((testDef, index) => {
    const status = statuses[testDef.key] || 'pending';
    const label = status === 'pass'
      ? '[OK]'
      : status === 'fail'
        ? '[FAIL]'
        : status === 'skip'
          ? '[SKIP]'
        : status === 'running'
          ? '[..]'
          : '[ ]';
    return `${label} ${index + 1}/${TESTS.length} ${testDef.name}`;
  }).join('\n');
}

function createStickyHeader() {
  const statuses = {};
  const isTTY = Boolean(process.stdout.isTTY);
  let headerLines = 0;
  let initialized = false;

  const buildHeader = () => {
    const header = `Integration test status:\n${renderStatus(statuses)}`;
    headerLines = header.split('\n').length;
    return header;
  };

  const init = () => {
    if (!isTTY || initialized) return;
    initialized = true;
    const header = buildHeader();
    const rows = process.stdout.rows || 24;

    process.stdout.write('\u001b[2J');
    process.stdout.write('\u001b[H');
    process.stdout.write(`${header}\n`);

    const scrollStart = Math.min(headerLines + 1, rows);
    process.stdout.write(`\u001b[${scrollStart};${rows}r`);
    process.stdout.write(`\u001b[${rows};1H`);
  };

  const update = () => {
    const header = buildHeader();
    if (!isTTY) {
      process.stdout.write(`${header}\n`);
      return;
    }
    if (!initialized) init();
    process.stdout.write('\u001b7');
    process.stdout.write('\u001b[H');
    process.stdout.write('\u001b[J');
    process.stdout.write(`${header}\n`);
    process.stdout.write('\u001b8');
  };

  const reset = () => {
    if (!isTTY || !initialized) return;
    process.stdout.write('\u001b[r');
  };

  return {
    init,
    setRunning(key) {
      statuses[key] = 'running';
      update();
    },
    setPass(key) {
      statuses[key] = 'pass';
      update();
    },
    setFail(key) {
      statuses[key] = 'fail';
      update();
    },
    setSkip(key) {
      statuses[key] = 'skip';
      update();
    },
    reset
  };
}

async function logAccountInfo() {
  const creds = loadCredentials();
  if (!creds) {
    console.log('Sogni login: unknown (missing credentials)');
    return;
  }
  console.log(`Sogni login: ${creds.username}`);

  const Wrapper = await getSogniClientWrapper();
  const client = new Wrapper({
    username: creds.username,
    password: creds.password,
    autoConnect: false,
    authType: 'token'
  });

  try {
    await client.connect();
    const balance = await client.getBalance();
    console.log(`Balance: ${formatNumber(balance.sogni)} SOGNI, ${formatNumber(balance.spark)} SPARK`);
  } catch (err) {
    console.log(`Balance: unavailable (${err?.message || 'error'})`);
  } finally {
    try {
      if (client.isConnected?.()) await client.disconnect();
    } catch (err) {
      // Ignore disconnect errors.
    }
  }
}

async function checkVideoBudget({ workflow, label, width, height, fps, duration, frames, count }) {
  const creds = loadCredentials();
  if (!creds) {
    return { ok: false, reason: 'Missing credentials' };
  }

  const modelId = resolveVideoModel(workflow);
  if (!modelId) {
    return { ok: true };
  }

  const tokenType = defaultTokenType;
  const tokenLabel = tokenType.toUpperCase();
  const resolvedFps = fps ?? openclawConfig?.defaultFps ?? 16;
  const resolvedDuration = duration ?? openclawConfig?.defaultDurationSec ?? 5;
  const modelDefaults = openclawConfig?.modelDefaults?.[modelId] || null;
  const steps = resolveVideoSteps(modelId, modelDefaults, null);

  const Wrapper = await getSogniClientWrapper();
  const client = new Wrapper({
    username: creds.username,
    password: creds.password,
    autoConnect: false,
    authType: 'token'
  });

  try {
    await client.connect();
    const balance = await client.getBalance();
    const available = tokenType === 'sogni' ? balance.sogni : balance.spark;
    if (!Number.isFinite(available) || available <= 0) {
      return {
        ok: false,
        reason: `Insufficient ${tokenLabel} balance (have ${formatNumber(available)})`
      };
    }

    if (!Number.isFinite(steps) || steps <= 0) {
      return { ok: true };
    }

    const estimate = await client.estimateVideoCost({
      modelId,
      width,
      height,
      fps: resolvedFps,
      steps,
      numberOfMedia: count,
      tokenType,
      ...(frames ? { frames } : { duration: resolvedDuration })
    });
    const required = parseCostEstimate(estimate, tokenType);
    if (Number.isFinite(required) && available < required) {
      return {
        ok: false,
        reason: `Insufficient ${tokenLabel} balance (need ~${formatNumber(required)}, have ${formatNumber(available)})`
      };
    }
    return { ok: true };
  } catch (err) {
    console.log(`Balance check skipped for ${label}: ${err?.message || 'error'}`);
    return { ok: true };
  } finally {
    try {
      if (client.isConnected?.()) await client.disconnect();
    } catch (err) {
      // Ignore disconnect errors.
    }
  }
}

function runCli(args, label) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(process.cwd(), 'sogni-gen.mjs'), ...args], {
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let elapsed = 0;
    const heartbeat = setInterval(() => {
      elapsed += 60;
      console.log(`[heartbeat] ${label}: +${elapsed}s`);
    }, 60000);

    const timeout = setTimeout(() => {
      clearInterval(heartbeat);
      child.kill('SIGKILL');
      reject(new Error(`CLI timed out after ${PROCESS_TIMEOUT_MS / 1000}s`));
    }, PROCESS_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on('error', (err) => {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      reject(err);
    });

    child.on('close', (code) => {
      clearInterval(heartbeat);
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`CLI failed (code ${code}).\nSTDERR:\n${stderr}\nSTDOUT:\n${stdout}`));
        return;
      }
      const trimmed = stdout.trim();
      if (!trimmed) {
        reject(new Error(`CLI returned no JSON output. STDERR:\n${stderr}`));
        return;
      }
      let json;
      try {
        json = JSON.parse(trimmed);
      } catch (err) {
        reject(new Error(`Failed to parse JSON output.\nSTDOUT:\n${stdout}\nSTDERR:\n${stderr}`));
        return;
      }
      resolve(json);
    });
  });
}

async function runSubtest(t, status, key, name, fn) {
  status.setRunning(key);
  let caughtError = null;
  try {
    await t.test(name, async () => {
      try {
        await fn();
      } catch (err) {
        caughtError = err;
        throw err;
      }
    });
  } catch (err) {
    caughtError = caughtError || err;
  }
  if (caughtError) {
    status.setFail(key);
    throw caughtError;
  }
  status.setPass(key);
}

if (!shouldRun) {
  test('integration: generate image + videos (skipped)', { skip: 'Set SOGNI_INTEGRATION=0 to skip integration tests.' }, () => {});
} else if (!hasCreds) {
  test('integration: generate image + videos (skipped)', { skip: 'Provide SOGNI_USERNAME/SOGNI_PASSWORD or ~/.config/sogni/credentials.' }, () => {});
} else {
  test('integration: text-to-image, text-to-video, image-to-video', async (t) => {
    const status = createStickyHeader();
    status.init();

    await logAccountInfo();

    const workDir = mkdtempSync(join(tmpdir(), 'sogni-gen-int-'));
    const imagePath = join(workDir, 't2i-512.png');
    const total = TESTS.length;

    try {
      await runSubtest(t, status, 't2i', 'Text-to-image 512x512', async () => {
        console.log(`Running test 1/${total}: Text-to-image 512x512`);
        const json = await runCli([
          '--json',
          '--width', '512',
          '--height', '512',
          '--timeout', String(IMAGE_TIMEOUT_SEC),
          '-o', imagePath,
          'a simple ceramic mug on a wooden table'
        ], 'Text-to-image 512x512');

        assert.equal(json.success, true);
        assert.equal(json.type, 'image');
        assert.equal(json.width, 512);
        assert.equal(json.height, 512);
        assert.ok(Array.isArray(json.urls) && json.urls.length > 0, 'image url missing');
        assert.ok(existsSync(imagePath), 'image file not written');
      });

      const t2vBudget = await checkVideoBudget({
        workflow: 't2v',
        label: 'Text-to-video 512x512',
        width: 512,
        height: 512,
        count: 1
      });
      if (!t2vBudget.ok) {
        const reason = t2vBudget.reason || 'Insufficient balance for video render';
        status.setSkip('t2v');
        await t.test('Text-to-video 512x512', { skip: reason }, () => {});
      } else {
        await runSubtest(t, status, 't2v', 'Text-to-video 512x512', async () => {
          console.log(`Running test 2/${total}: Text-to-video 512x512`);
          const json = await runCli([
            '--json',
            '--video',
            '--workflow', 't2v',
            '--width', '512',
            '--height', '512',
            '--timeout', String(VIDEO_TIMEOUT_SEC),
            'soft clouds drifting across the sky'
          ], 'Text-to-video 512x512');

          assert.equal(json.success, true);
          assert.equal(json.type, 'video');
          assert.equal(json.workflow, 't2v');
          assert.equal(json.width, 512);
          assert.equal(json.height, 512);
          assert.ok(Array.isArray(json.urls) && json.urls.length > 0, 'video url missing');
        });
      }

      const i2vBudget = await checkVideoBudget({
        workflow: 'i2v',
        label: 'Image-to-video 512x512',
        width: 512,
        height: 512,
        count: 1
      });
      if (!i2vBudget.ok) {
        const reason = i2vBudget.reason || 'Insufficient balance for video render';
        status.setSkip('i2v');
        await t.test('Image-to-video 512x512', { skip: reason }, () => {});
      } else {
        await runSubtest(t, status, 'i2v', 'Image-to-video 512x512', async () => {
          console.log(`Running test 3/${total}: Image-to-video 512x512`);
          const json = await runCli([
            '--json',
            '--video',
            '--workflow', 'i2v',
            '--ref', imagePath,
            '--width', '512',
            '--height', '512',
            '--timeout', String(VIDEO_TIMEOUT_SEC),
            'gentle camera pan'
          ], 'Image-to-video 512x512');

          assert.equal(json.success, true);
          assert.equal(json.type, 'video');
          assert.equal(json.workflow, 'i2v');
          assert.equal(json.width, 512);
          assert.equal(json.height, 512);
          assert.equal(json.refImage, imagePath);
          assert.ok(Array.isArray(json.urls) && json.urls.length > 0, 'video url missing');
        });
      }
    } finally {
      status.reset();
    }
  });
}
