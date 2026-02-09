import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const MIN_NODE_VERSION = [22, 22, 0];

function isVersionAtLeast(current, required) {
  for (let i = 0; i < required.length; i++) {
    const currentValue = current[i] ?? 0;
    const requiredValue = required[i] ?? 0;
    if (currentValue > requiredValue) return true;
    if (currentValue < requiredValue) return false;
  }
  return true;
}

const currentNodeVersion = process.versions.node.split('.').map((part) => Number(part));
if (!isVersionAtLeast(currentNodeVersion, MIN_NODE_VERSION)) {
  throw new Error(`Node >= ${MIN_NODE_VERSION.join('.')} is required. Current: ${process.versions.node}`);
}

function runCli(args) {
  const tempHome = mkdtempSync(join(tmpdir(), 'sogni-gen-test-'));
  const statePath = join(tempHome, 'state.json');
  const loaderPath = join(process.cwd(), 'test', 'loader.mjs');
  const cliPath = join(process.cwd(), 'sogni-gen.mjs');

  const env = {
    ...process.env,
    HOME: tempHome,
    USERPROFILE: tempHome,
    OPENCLAW_CONFIG_PATH: join(tempHome, 'openclaw.json'),
    OPENCLAW_PLUGIN_CONFIG: '',
    SOGNI_USERNAME: 'test-user',
    SOGNI_PASSWORD: 'test-pass',
    SOGNI_GEN_TEST_STATE_PATH: statePath,
    NODE_NO_WARNINGS: '1'
  };

  const result = spawnSync(
    process.execPath,
    ['--loader', loaderPath, cliPath, ...args],
    { env, encoding: 'utf8' }
  );

  if (result.error) {
    throw result.error;
  }

  let state = null;
  try {
    state = JSON.parse(readFileSync(statePath, 'utf8'));
  } catch (err) {
    state = null;
  }

  return {
    exitCode: result.status,
    state,
    stdout: result.stdout,
    stderr: result.stderr
  };
}

test('default image generation uses 512x512 and prompt', () => {
  const { exitCode, state } = runCli(['a cat wearing a hat']);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastImageProject, 'createImageProject was called');
  assert.equal(state.lastImageProject.width, 512);
  assert.equal(state.lastImageProject.height, 512);
  assert.equal(state.lastImageProject.positivePrompt, 'a cat wearing a hat');
  assert.equal(state.lastImageProject.tokenType, 'spark');
  assert.equal(state.lastImageProject.sizePreset, 'custom');
});

test('explicit 512x512, output format, and seed are applied', () => {
  const { exitCode, state } = runCli([
    '--width', '512',
    '--height', '512',
    '--output-format', 'jpg',
    '--seed', '42',
    'neon cyberpunk city'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastImageProject);
  assert.equal(state.lastImageProject.width, 512);
  assert.equal(state.lastImageProject.height, 512);
  assert.equal(state.lastImageProject.outputFormat, 'jpg');
  assert.equal(state.lastImageProject.seed, 42);
});

test('count is forwarded to image generation', () => {
  const { exitCode, state } = runCli([
    '--count', '2',
    'a watercolor landscape'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastImageProject);
  assert.equal(state.lastImageProject.numberOfMedia, 2);
});

test('i2v infers a 16-multiple video size from non-square reference when width/height not explicitly set', () => {
  const { exitCode, state } = runCli([
    '--video',
    '--workflow', 'i2v',
    '--ref', 'screenshot.jpg',
    '--duration', '1',
    'gentle camera pan'
  ]);
  assert.equal(exitCode, 0);
  assert.ok(state?.lastVideoProject, 'createVideoProject was called');
  // screenshot.jpg is 1170x1200 (39:40). Smallest 16-multiple size near the default maxDim is 624x640.
  assert.equal(state.lastVideoProject.width, 624);
  assert.equal(state.lastVideoProject.height, 640);
});

test('json error: video width/height must be divisible by 16', () => {
  const { exitCode, stdout } = runCli([
    '--json',
    '--video',
    '--width', '500',
    '--height', '512',
    'ocean waves'
  ]);
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, false);
  assert.equal(payload.errorCode, 'INVALID_VIDEO_SIZE');
  assert.ok(payload.error.includes('divisible by 16'));
});

test('json error: i2v rejects mismatched explicit size and suggests a compatible 16-multiple aspect', () => {
  const { exitCode, stdout } = runCli([
    '--json',
    '--video',
    '--workflow', 'i2v',
    '--ref', 'screenshot.jpg',
    '--width', '512',
    '--height', '512',
    'gentle camera pan'
  ]);
  assert.equal(exitCode, 1);
  const payload = JSON.parse(stdout.trim());
  assert.equal(payload.success, false);
  assert.equal(payload.errorCode, 'INVALID_VIDEO_SIZE');
  assert.ok(String(payload.hint || '').includes('--width 624 --height 640'));
});
