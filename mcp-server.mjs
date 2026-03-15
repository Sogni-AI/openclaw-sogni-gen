#!/usr/bin/env node
/**
 * sogni-gen MCP Server
 *
 * Exposes Sogni AI image/video generation as MCP tools for Claude Code
 * and Claude Desktop.  Wraps the sogni-gen CLI using its --json mode.
 *
 * Install (Claude Code):
 *   claude mcp add sogni -- npx -y -p sogni-gen sogni-gen-mcp
 *
 * Install (Claude Desktop – add to claude_desktop_config.json):
 *   { "mcpServers": { "sogni": { "command": "npx", "args": ["-y", "-p", "sogni-gen", "sogni-gen-mcp"] } } }
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { execaNode } from 'execa';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { getEnv, hasEnv } from './env.mjs';
import { PACKAGE_VERSION } from './version.mjs';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SOGNI_GEN = join(__dirname, 'sogni-gen.mjs');
const DEFAULT_CREDENTIALS_PATH = join(homedir(), '.config', 'sogni', 'credentials');
const DEFAULT_DOWNLOADS_DIR = join(homedir(), 'Downloads', 'sogni');
const CREDENTIALS_PATH = getEnv('SOGNI_CREDENTIALS_PATH', { trim: true }) || DEFAULT_CREDENTIALS_PATH;
const DOWNLOADS_DIR = getEnv('SOGNI_DOWNLOADS_DIR', { trim: true }) || DEFAULT_DOWNLOADS_DIR;
const MCP_SAVE_DOWNLOADS = getEnv('SOGNI_MCP_SAVE_DOWNLOADS') !== '0';
const SERVER_VERSION = PACKAGE_VERSION;
const DEFAULT_ALLOWED_DOWNLOAD_HOST_SUFFIXES = ['sogni.ai'];
const ALLOWED_DOWNLOAD_HOST_SUFFIXES = (
  getEnv('SOGNI_ALLOWED_DOWNLOAD_HOSTS', { trim: true }) || ''
)
  .split(',')
  .map((value) => value.trim().toLowerCase())
  .filter(Boolean);

function isTrustedDownloadUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const hostname = parsed.hostname.toLowerCase();
    const allowed = ALLOWED_DOWNLOAD_HOST_SUFFIXES.length > 0
      ? ALLOWED_DOWNLOAD_HOST_SUFFIXES
      : DEFAULT_ALLOWED_DOWNLOAD_HOST_SUFFIXES;
    return allowed.some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Input sanitization — validate MCP tool inputs before passing to CLI
// ---------------------------------------------------------------------------

/**
 * Reject null bytes and control characters in a string value.
 * Throws on invalid input; returns the string unchanged when valid.
 */
function sanitizeString(value, label) {
  if (typeof value !== 'string') {
    throw new Error(`${label || 'Value'} must be a string.`);
  }
  if (value.includes('\0')) {
    throw new Error(`${label || 'Value'} contains a null byte.`);
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) {
    throw new Error(`${label || 'Value'} contains invalid control characters.`);
  }
  return value;
}

/**
 * Validate a string is one of the allowed values (case-sensitive).
 */
function validateEnum(value, allowed, label) {
  sanitizeString(value, label);
  if (!allowed.includes(value)) {
    throw new Error(`${label || 'Value'} must be one of: ${allowed.join(', ')}`);
  }
  return value;
}

// ---------------------------------------------------------------------------
// CLI spawning helper
// ---------------------------------------------------------------------------

/**
 * Spawn `node sogni-gen.mjs --json ...args`, collect stdout, parse JSON.
 * Returns the parsed object on success or throws on failure.
 */
function runSogniGen(args, { timeoutMs = 30_000 } = {}) {
  return new Promise((resolve, reject) => {
    execaNode(SOGNI_GEN, ['--json', '--quiet', ...args], {
      timeout: timeoutMs,
      reject: false,
    }).then(({ stdout, stderr, exitCode, timedOut }) => {
      const trimmedStdout = (stdout || '').trim();
      const trimmedStderr = (stderr || '').trim();

      if (!trimmedStdout) {
        if (timedOut) {
          reject(new Error(`sogni-gen timed out after ${timeoutMs}ms`));
          return;
        }
        reject(new Error(trimmedStderr || `sogni-gen exited with code ${exitCode} and no output`));
        return;
      }

      try {
        const result = JSON.parse(trimmedStdout);
        resolve(result);
      } catch {
        reject(new Error(`Failed to parse sogni-gen output: ${trimmedStdout.slice(0, 500)}`));
      }
    }).catch((err) => {
      reject(new Error(`Failed to execute sogni-gen: ${err.message}`));
    });
  });
}

// ---------------------------------------------------------------------------
// Credential check helper
// ---------------------------------------------------------------------------

function checkCredentials() {
  if (existsSync(CREDENTIALS_PATH)) {
    try {
      const raw = readFileSync(CREDENTIALS_PATH, 'utf8');
      if (raw.includes('SOGNI_API_KEY=')) return null;
      if (raw.includes('SOGNI_USERNAME=') && raw.includes('SOGNI_PASSWORD=')) return null;
    } catch {
      // Fall through to env-based checks and error message.
    }
  }
  if (hasEnv('SOGNI_API_KEY')) return null;
  if (hasEnv('SOGNI_USERNAME') && hasEnv('SOGNI_PASSWORD')) return null;
  return {
    content: [
      {
        type: 'text',
        text: [
          'Sogni credentials not found. Please set up credentials:',
          '',
          '1. Create a Sogni account at https://app.sogni.ai/',
          '2. Create the credentials file:',
          '',
          '   mkdir -p ~/.config/sogni',
          '   cat > ~/.config/sogni/credentials << \'EOF\'',
          '   SOGNI_API_KEY=your_api_key',
          '   # or use username/password instead:',
          '   # SOGNI_USERNAME=your_username',
          '   # SOGNI_PASSWORD=your_password',
          '   EOF',
          '   chmod 600 ~/.config/sogni/credentials',
          '',
          'Or set SOGNI_API_KEY, or SOGNI_USERNAME and SOGNI_PASSWORD, as environment variables.',
          'Optional: set SOGNI_CREDENTIALS_PATH to use a different credentials file path.',
        ].join('\n'),
      },
    ],
    isError: true,
  };
}

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------

async function formatSuccess(result) {
  const parts = [];

  if (result.type === 'balance') {
    parts.push(`SPARK: ${result.spark ?? 'N/A'}`);
    parts.push(`SOGNI: ${result.sogni ?? 'N/A'}`);
    return { content: [{ type: 'text', text: parts.join('\n') }] };
  }

  // Image / video result
  if (result.prompt) parts.push(`Prompt: ${result.prompt}`);
  parts.push(`Model: ${result.model}`);
  parts.push(`Size: ${result.width}x${result.height}`);
  if (result.seed != null) parts.push(`Seed: ${result.seed}`);

  if (result.type === 'video') {
    if (result.workflow) parts.push(`Workflow: ${result.workflow}`);
    if (result.duration) parts.push(`Duration: ${result.duration}s`);
    if (result.fps) parts.push(`FPS: ${result.fps}`);
  }

  if (result.localPath) parts.push(`Saved to: ${result.localPath}`);

  // URLs
  const urls = result.urls || [];
  if (urls.length > 0) {
    parts.push('');
    urls.forEach((url, i) => {
      parts.push(urls.length === 1 ? `URL: ${url}` : `URL #${i + 1}: ${url}`);
    });
  }

  const content = [{ type: 'text', text: parts.join('\n') }];

  // Download images/videos and save locally + embed as base64 for MCP clients
  // that support inline image rendering (e.g. Claude Desktop).
  // For Claude Code (terminal), the saved file path is the primary way to view results.
  const savedPaths = [];
  for (const url of urls) {
    const isImage = /\.(png|jpg|jpeg|webp|gif)(\?|$)/i.test(url);
    const isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url);

    if (!isImage && !isVideo) continue;
    if (!isTrustedDownloadUrl(url)) {
      parts.push(`Skipped local download for untrusted host: ${url}`);
      continue;
    }

    try {
      const resp = await fetch(url);
      if (!resp.ok) continue;
      const buf = Buffer.from(await resp.arrayBuffer());

      // Determine extension and build a temp file path
      const ext = isImage
        ? (url.match(/\.(png|jpg|jpeg|webp|gif)/i)?.[1]?.toLowerCase() || 'png')
        : (url.match(/\.(mp4|webm|mov)/i)?.[1]?.toLowerCase() || 'mp4');

      // Save to local disk (default: ~/Downloads/sogni) so terminal users can open files.
      if (MCP_SAVE_DOWNLOADS) {
        const { mkdirSync, writeFileSync } = await import('fs');
        mkdirSync(DOWNLOADS_DIR, { recursive: true });
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `sogni-${timestamp}-${savedPaths.length}.${ext}`;
        const filePath = join(DOWNLOADS_DIR, filename);
        writeFileSync(filePath, buf);
        savedPaths.push(filePath);
      }

      // For images, also embed as base64 (Claude Desktop can render these)
      if (isImage) {
        const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
          : ext === 'webp' ? 'image/webp'
          : ext === 'gif' ? 'image/gif'
          : 'image/png';
        content.push({ type: 'image', data: buf.toString('base64'), mimeType });
      }
    } catch {
      // If download fails, skip — the URL is still in the text above
    }
  }

  // Append saved file paths to the text output so Claude Code users can see/open them
  if (savedPaths.length > 0) {
    const textBlock = content[0];
    textBlock.text += '\n\n' + savedPaths.map((p, i) =>
      savedPaths.length === 1 ? `📁 Saved: ${p}` : `📁 Saved #${i + 1}: ${p}`
    ).join('\n');
    textBlock.text += '\n\nTip: In Claude Code, ask Claude to run `open <path>` to view the file.';
  }

  return { content };
}

function formatError(result) {
  const parts = [`Error: ${result.error}`];
  if (result.errorCode) parts.push(`Code: ${result.errorCode}`);
  if (result.hint) parts.push(`Hint: ${result.hint}`);
  return { content: [{ type: 'text', text: parts.join('\n') }], isError: true };
}

async function formatResult(result) {
  if (result.success === false) return formatError(result);
  return formatSuccess(result);
}

async function runAndFormat(args, { timeoutMs = 30_000, requireCredentials = true } = {}) {
  if (requireCredentials) {
    const credErr = checkCredentials();
    if (credErr) return credErr;
  }
  const result = await runSogniGen(args, { timeoutMs });
  return formatResult(result);
}

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

const IMAGE_MODEL_TABLE = `Image Models:
  z_image_turbo_bf16         — Fast (~5-10s), general purpose (default)
  flux1-schnell-fp8          — Very fast (~3-5s), quick iterations
  flux2_dev_fp8              — Slow (~2min), high quality
  chroma-v.46-flash_fp8      — Medium (~30s), balanced
  qwen_image_edit_2511_fp8   — Medium (~30s), image editing with context
  qwen_image_edit_2511_fp8_lightning — Fast (~8s), quick image editing`;

const VIDEO_MODEL_TABLE = `WAN 2.2 Video Models (auto-selected per workflow):
  wan_v2.2-14b-fp8_t2v_lightx2v             — Text-to-video (~5min)
  wan_v2.2-14b-fp8_i2v_lightx2v             — Image-to-video (~3-5min)
  wan_v2.2-14b-fp8_s2v_lightx2v             — Sound-to-video (~5min)
  wan_v2.2-14b-fp8_animate-move_lightx2v    — Animate-move (~5min)
  wan_v2.2-14b-fp8_animate-replace_lightx2v — Animate-replace (~5min)

LTX-2 / LTX-2.3 Video Models:
  ltx2-19b-fp8_t2v_distilled              — Text-to-video, fast 8-step (~2-3min)
  ltx2-19b-fp8_t2v                        — Text-to-video, quality 20-step (~5min)
  ltx2-19b-fp8_i2v_distilled              — Image-to-video, fast 8-step (~2-3min)
  ltx2-19b-fp8_i2v                        — Image-to-video, quality 20-step (~5min)
  ltx2-19b-fp8_ia2v_distilled             — Image+audio-to-video, fast 8-step (~2-3min)
  ltx2-19b-fp8_a2v_distilled              — Audio-to-video, fast 8-step (~2-3min)
  ltx2-19b-fp8_v2v_distilled              — Video-to-video with ControlNet (~3min)
  ltx2-19b-fp8_v2v                        — Video-to-video with ControlNet, quality (~5min)
  ltx23-22b-fp8_t2v_distilled             — Text-to-video, LTX-2.3 fast distilled (~2-3min)`;

const AUDIO_MODEL_TABLE = `Audio Models:
  ace_step_1.5_turbo         — Fast (~30s), general purpose (default)
  ace_step_1.5_sft           — Higher quality, consistent style`;

const TOOLS = [
  {
    name: 'generate_image',
    description: `Generate an image using Sogni AI's decentralized GPU network.

${IMAGE_MODEL_TABLE}

Cost: Uses Spark tokens. 512x512 is most cost-efficient. Claim 50 free daily Spark at https://app.sogni.ai/`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Image description / generation prompt',
        },
        model: {
          type: 'string',
          description: 'Model ID (default: z_image_turbo_bf16)',
        },
        width: {
          type: 'number',
          description: 'Image width in pixels (default: 512)',
        },
        height: {
          type: 'number',
          description: 'Image height in pixels (default: 512)',
        },
        count: {
          type: 'number',
          description: 'Number of images to generate (default: 1)',
        },
        seed: {
          type: 'number',
          description: 'Specific seed for reproducibility',
        },
        output: {
          type: 'string',
          description: 'Save image to this file path',
        },
        output_format: {
          type: 'string',
          enum: ['png', 'jpg'],
          description: 'Output format (default: png)',
        },
        loras: {
          type: 'array',
          items: { type: 'string' },
          description: 'LoRA model IDs',
        },
        lora_strengths: {
          type: 'array',
          items: { type: 'number' },
          description: 'LoRA strengths (parallel to loras array)',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'generate_video',
    description: `Generate a video using Sogni AI's decentralized GPU network.

Workflows:
  t2v             — Text-to-video (default). Just provide a prompt.
  i2v             — Image-to-video. Provide ref (reference image). Supports looping.
  s2v             — Sound-to-video. Provide ref (face image) + ref_audio.
  ia2v            — Image+audio-to-video (LTX). Provide ref + ref_audio.
  a2v             — Audio-to-video (LTX). Provide ref_audio only.
  v2v             — Video-to-video (LTX). Provide ref_video + controlnet_name.
  animate-move    — Transfer motion from ref_video to ref image.
  animate-replace — Replace subject in ref_video with ref image.

${VIDEO_MODEL_TABLE}

WAN video dimensions: divisible by 16, min 480px, max 1536px. LTX family: divisible by 64, 768-1920px.
Generation takes 3-5 minutes. Cost: Uses Spark tokens. Claim 50 free daily Spark at https://app.sogni.ai/`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Video description / generation prompt',
        },
        workflow: {
          type: 'string',
          enum: ['t2v', 'i2v', 's2v', 'ia2v', 'a2v', 'v2v', 'animate-move', 'animate-replace'],
          description: 'Video workflow (default: t2v, auto-inferred from provided refs)',
        },
        model: {
          type: 'string',
          description: 'Model ID (auto-selected per workflow by default)',
        },
        width: {
          type: 'number',
          description: 'Video width in pixels (default: 512, must be divisible by 16)',
        },
        height: {
          type: 'number',
          description: 'Video height in pixels (default: 512, must be divisible by 16)',
        },
        fps: {
          type: 'number',
          description: 'Frames per second (default: 16)',
        },
        duration: {
          type: 'number',
          description: 'Duration in seconds (default: 5)',
        },
        frames: {
          type: 'number',
          description: 'Override total frame count (alternative to duration)',
        },
        ref: {
          type: 'string',
          description: 'Reference image path or URL (for i2v, s2v, animate workflows)',
        },
        ref_end: {
          type: 'string',
          description: 'End frame image path or URL (for i2v interpolation)',
        },
        ref_audio: {
          type: 'string',
          description: 'Reference audio file path (for s2v workflow)',
        },
        ref_video: {
          type: 'string',
          description: 'Reference video file path (for animate and v2v workflows)',
        },
        controlnet_name: {
          type: 'string',
          enum: ['canny', 'pose', 'depth', 'detailer'],
          description: 'ControlNet type for v2v workflow',
        },
        controlnet_strength: {
          type: 'number',
          description: 'ControlNet strength for v2v (0.0-1.0, default: 0.8)',
        },
        sam2_coordinates: {
          type: 'string',
          description: 'SAM2 click coordinates for animate-replace (x,y or x1,y1;x2,y2)',
        },
        trim_end_frame: {
          type: 'boolean',
          description: 'Trim last frame for seamless video stitching',
        },
        first_frame_strength: {
          type: 'number',
          description: 'Keyframe strength for start frame (0.0-1.0)',
        },
        last_frame_strength: {
          type: 'number',
          description: 'Keyframe strength for end frame (0.0-1.0)',
        },
        seed: {
          type: 'number',
          description: 'Specific seed for reproducibility',
        },
        output: {
          type: 'string',
          description: 'Save video to this file path',
        },
        looping: {
          type: 'boolean',
          description: 'Generate seamless loop (i2v only)',
        },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'edit_image',
    description: `Edit or transform an existing image using Sogni AI (Qwen image editing models).

Provide 1-3 context images and a prompt describing the desired edit. Examples:
  - "make the background a beach"
  - "apply pop art style"
  - "remove the person on the left"
  - "add a rainbow in the sky"

Models:
  qwen_image_edit_2511_fp8_lightning — Fast (~8s), default
  qwen_image_edit_2511_fp8          — Medium (~30s), higher quality`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Editing instruction describing the desired change',
        },
        context_images: {
          type: 'array',
          items: { type: 'string' },
          description: 'Image file paths or URLs to edit (1-3 images)',
          minItems: 1,
          maxItems: 3,
        },
        model: {
          type: 'string',
          description: 'Model ID (default: qwen_image_edit_2511_fp8_lightning)',
        },
        width: {
          type: 'number',
          description: 'Output width in pixels',
        },
        height: {
          type: 'number',
          description: 'Output height in pixels',
        },
        output: {
          type: 'string',
          description: 'Save edited image to this file path',
        },
      },
      required: ['prompt', 'context_images'],
    },
  },
  {
    name: 'photobooth',
    description: `Generate stylized portraits from a face photo using InstantID face transfer.

Provide a face reference image and a style prompt. Examples:
  - "80s fashion portrait"
  - "LinkedIn professional headshot"
  - "oil painting Renaissance style"
  - "anime character"

Uses SDXL Turbo (coreml-sogniXLturbo_alpha1_ad) at 1024x1024 by default.
The face likeness is preserved while applying the style from the prompt.`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Style/scene description for the portrait',
        },
        reference_face: {
          type: 'string',
          description: 'Face image file path or URL',
        },
        model: {
          type: 'string',
          description: 'Model ID (default: coreml-sogniXLturbo_alpha1_ad)',
        },
        cn_strength: {
          type: 'number',
          description: 'ControlNet strength — higher = more face likeness (default: 0.8)',
        },
        cn_guidance_end: {
          type: 'number',
          description: 'ControlNet guidance end point (default: 0.3)',
        },
        width: {
          type: 'number',
          description: 'Output width in pixels (default: 1024)',
        },
        height: {
          type: 'number',
          description: 'Output height in pixels (default: 1024)',
        },
        count: {
          type: 'number',
          description: 'Number of images to generate (default: 1)',
        },
        output: {
          type: 'string',
          description: 'Save image to this file path',
        },
      },
      required: ['prompt', 'reference_face'],
    },
  },
  {
    name: 'check_balance',
    description:
      'Check your current Sogni token balances (SPARK and SOGNI). Free daily Spark tokens can be claimed at https://app.sogni.ai/',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'list_models',
    description:
      'List all available Sogni AI models for image generation, image editing, photobooth, and video generation with speed estimates.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_version',
    description: 'Show the running sogni-gen version for this MCP server instance.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'extract_last_frame',
    description: 'Extract the last frame from a video file as an image. Safe ffmpeg wrapper with input sanitization.',
    inputSchema: {
      type: 'object',
      properties: {
        video_path: {
          type: 'string',
          description: 'Path to the source video file',
        },
        output_path: {
          type: 'string',
          description: 'Path to save the extracted frame image (e.g. /tmp/lastframe.png)',
        },
      },
      required: ['video_path', 'output_path'],
    },
  },
  {
    name: 'concat_videos',
    description: 'Concatenate multiple video clips into a single video file. Safe ffmpeg wrapper with input sanitization. Requires at least 2 clips.',
    inputSchema: {
      type: 'object',
      properties: {
        output_path: {
          type: 'string',
          description: 'Path for the concatenated output video',
        },
        clips: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of video clip file paths to concatenate (minimum 2)',
          minItems: 2,
        },
      },
      required: ['output_path', 'clips'],
    },
  },
  {
    name: 'list_media',
    description: 'List recent inbound media files (images, audio, or all) from the user media directory (~/.clawdbot/media/inbound/). Returns the 5 most recent files sorted by modification time.',
    inputSchema: {
      type: 'object',
      properties: {
        type: {
          type: 'string',
          enum: ['images', 'audio', 'all'],
          description: 'Type of media to list (default: images)',
        },
      },
    },
  },
  {
    name: 'generate_song',
    description: `Generate audio or music using Sogni AI's decentralized GPU network.

Workflows:
  music           — Music generation (default). Just provide a prompt.

${AUDIO_MODEL_TABLE}

Minimum duration is 10 seconds. Cost: Uses Spark tokens. Claim 50 free daily Spark at https://app.sogni.ai/`,
    inputSchema: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'Base description of the audio/song. Can be empty if other parameters (genre/mood/lyrics/etc.) are provided.',
        },
        workflow: {
          type: 'string',
          enum: ['music'],
          description: 'Audio workflow (default: music)',
        },
        model: {
          type: 'string',
          description: 'Model ID (default: ace_step_1.5_turbo)',
        },
        genre: {
          type: 'string',
          description: 'Music genre (e.g. "jazz", "lo-fi", "metal")',
        },
        mood: {
          type: 'string',
          description: 'Emotional tone (e.g. "chill", "epic", "melancholy")',
        },
        tempo: {
          type: 'string',
          description: 'Speed or BPM (e.g. "fast", "slow", "128bpm")',
        },
        instruments: {
          type: 'string',
          description: 'Target instruments (e.g. "piano, violin", "heavy drums")',
        },
        lyrics: {
          type: 'string',
          description: 'Words or lyrics to include in the track',
        },
        instrumental: {
          type: 'boolean',
          description: 'Force an instrumental track (default: true if no lyrics, false if lyrics provided)',
        },
        duration: {
          type: 'number',
          description: 'Target length of the audio in seconds. Minimum: 10, Default: 30.',
        },
        length: {
          type: 'number',
          description: 'Alias for duration. Target length of the audio in seconds. Default: 30.',
        },
        count: {
          type: 'number',
          description: 'How many variations to generate (default: 1).',
        },
        seed: {
          type: 'number',
          description: 'Optional seed for deterministic generation. Using the same seed with the same prompt will produce similar results.',
        },
        bpm: {
          type: 'number',
          description: 'Beats per minute (30-300, default: 120)',
        },
        time_signature: {
          type: 'string',
          description: 'Time signature (2, 3, 4, or 6 - default: 4)',
        },
        language: {
          type: 'string',
          description: 'Lyrics language code (default: en)',
        },
        keyscale: {
          type: 'string',
          description: 'Key/scale setting (e.g., "C major", "A minor")',
        },
        composer_mode: {
          type: 'boolean',
          description: 'Enable AI composer mode for higher quality (default: true)',
        },
        prompt_strength: {
          type: 'number',
          description: 'How closely to follow the prompt (0-10, default: 2.0)',
        },
        creativity: {
          type: 'number',
          description: 'Composition variation / temperature (0-2, default: 0.85)',
        },
        shift: {
          type: 'number',
          description: 'Distribution of denoising effort (1-6, default: 3)',
        },
        output_format: {
          type: 'string',
          description: 'Output audio format (mp3, flac, wav - default: mp3)',
        },
        output: {
          type: 'string',
          description: 'Optional local file path to save the generated audio (e.g., "my-song.mp3").',
        },
      },
      required: ['prompt'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

async function handleGenerateImage(params) {
  sanitizeString(params.prompt, 'prompt');
  const args = [];
  if (params.model) args.push('-m', sanitizeString(params.model, 'model'));
  if (params.width) args.push('-w', String(params.width));
  if (params.height) args.push('-h', String(params.height));
  if (params.count) args.push('-n', String(params.count));
  if (params.seed != null) args.push('-s', String(params.seed));
  if (params.output) args.push('-o', sanitizeString(params.output, 'output'));
  if (params.output_format) args.push('--output-format', validateEnum(params.output_format, ['png', 'jpg'], 'output_format'));
  if (params.loras?.length) {
    params.loras.forEach((l, i) => sanitizeString(l, `loras[${i}]`));
    args.push('--loras', params.loras.join(','));
  }
  if (params.lora_strengths?.length) args.push('--lora-strengths', params.lora_strengths.join(','));
  args.push('--', params.prompt);

  return runAndFormat(args, { timeoutMs: 60_000 });
}

async function handleGenerateVideo(params) {
  sanitizeString(params.prompt, 'prompt');
  const args = ['--video'];
  if (params.workflow) args.push('--workflow', validateEnum(params.workflow, ['t2v', 'i2v', 's2v', 'v2v', 'animate-move', 'animate-replace'], 'workflow'));
  if (params.model) args.push('-m', sanitizeString(params.model, 'model'));
  if (params.width) args.push('-w', String(params.width));
  if (params.height) args.push('-h', String(params.height));
  if (params.fps) args.push('--fps', String(params.fps));
  if (params.duration) args.push('--duration', String(params.duration));
  if (params.frames) args.push('--frames', String(params.frames));
  if (params.ref) args.push('--ref', sanitizeString(params.ref, 'ref'));
  if (params.ref_end) args.push('--ref-end', sanitizeString(params.ref_end, 'ref_end'));
  if (params.ref_audio) args.push('--ref-audio', sanitizeString(params.ref_audio, 'ref_audio'));
  if (params.ref_video) args.push('--ref-video', sanitizeString(params.ref_video, 'ref_video'));
  if (params.controlnet_name) args.push('--controlnet-name', validateEnum(params.controlnet_name, ['canny', 'pose', 'depth', 'detailer'], 'controlnet_name'));
  if (params.controlnet_strength != null) args.push('--controlnet-strength', String(params.controlnet_strength));
  if (params.sam2_coordinates) args.push('--sam2-coordinates', sanitizeString(params.sam2_coordinates, 'sam2_coordinates'));
  if (params.trim_end_frame) args.push('--trim-end-frame');
  if (params.first_frame_strength != null) args.push('--first-frame-strength', String(params.first_frame_strength));
  if (params.last_frame_strength != null) args.push('--last-frame-strength', String(params.last_frame_strength));
  if (params.seed != null) args.push('-s', String(params.seed));
  if (params.output) args.push('-o', sanitizeString(params.output, 'output'));
  if (params.looping) args.push('--looping');
  args.push('--', params.prompt);

  return runAndFormat(args, { timeoutMs: 600_000 });
}

async function handleEditImage(params) {
  sanitizeString(params.prompt, 'prompt');
  const args = [];
  for (const img of params.context_images) {
    args.push('-c', sanitizeString(img, 'context_images'));
  }
  if (params.model) args.push('-m', sanitizeString(params.model, 'model'));
  if (params.width) args.push('-w', String(params.width));
  if (params.height) args.push('-h', String(params.height));
  if (params.output) args.push('-o', sanitizeString(params.output, 'output'));
  args.push('--', params.prompt);

  return runAndFormat(args, { timeoutMs: 60_000 });
}

async function handlePhotobooth(params) {
  sanitizeString(params.prompt, 'prompt');
  sanitizeString(params.reference_face, 'reference_face');
  const args = ['--photobooth', '--ref', params.reference_face];
  if (params.model) args.push('-m', sanitizeString(params.model, 'model'));
  if (params.cn_strength != null) args.push('--cn-strength', String(params.cn_strength));
  if (params.cn_guidance_end != null) args.push('--cn-guidance-end', String(params.cn_guidance_end));
  if (params.width) args.push('-w', String(params.width));
  if (params.height) args.push('-h', String(params.height));
  if (params.count) args.push('-n', String(params.count));
  if (params.output) args.push('-o', sanitizeString(params.output, 'output'));
  args.push('--', params.prompt);

  return runAndFormat(args, { timeoutMs: 60_000 });
}

async function handleCheckBalance() {
  return runAndFormat(['--balance'], { timeoutMs: 30_000 });
}

async function handleGetVersion() {
  const result = await runSogniGen(['--version'], { timeoutMs: 5_000 });
  if (result.success === false) return formatError(result);
  return {
    content: [{
      type: 'text',
      text: `mcp-server version: ${SERVER_VERSION}\nsogni-gen version: ${result.version || 'unknown'}`,
    }],
  };
}

function handleListModels() {
  const text = `${IMAGE_MODEL_TABLE}

Photobooth Model:
  coreml-sogniXLturbo_alpha1_ad — Fast, face transfer (SDXL Turbo, default for --photobooth)

${VIDEO_MODEL_TABLE}

${AUDIO_MODEL_TABLE}

Defaults:
  Image generation: z_image_turbo_bf16
  Image editing:    qwen_image_edit_2511_fp8_lightning
  Photobooth:       coreml-sogniXLturbo_alpha1_ad
  Video:            auto-selected per workflow (t2v/i2v/s2v/ia2v/a2v/v2v/animate-move/animate-replace)
  Audio/Song:      ace_step_1.5_turbo (workflow: music)`;

  return { content: [{ type: 'text', text }] };
}

async function handleExtractLastFrame(params) {
  const videoPath = sanitizeString(params.video_path, 'video_path');
  const outputPath = sanitizeString(params.output_path, 'output_path');
  const result = await runSogniGen(['--extract-last-frame', videoPath, outputPath], { timeoutMs: 30_000 });
  if (result.success === false) return formatError(result);
  return { content: [{ type: 'text', text: `Extracted last frame to: ${result.outputPath || outputPath}` }] };
}

async function handleConcatVideos(params) {
  const outputPath = sanitizeString(params.output_path, 'output_path');
  if (!params.clips || params.clips.length < 2) {
    return { content: [{ type: 'text', text: 'Error: At least 2 clips are required.' }], isError: true };
  }
  const clips = params.clips.map((c, i) => sanitizeString(c, `clips[${i}]`));
  const result = await runSogniGen(['--concat-videos', outputPath, ...clips], { timeoutMs: 60_000 });
  if (result.success === false) return formatError(result);
  return { content: [{ type: 'text', text: `Concatenated ${result.clipCount || clips.length} clips to: ${result.outputPath || outputPath}` }] };
}

async function handleGenerateSong(params) {
  const args = ['--audio'];
  if (params.prompt) args.push('--', params.prompt);
  if (params.workflow) args.push('--audio-workflow', validateEnum(params.workflow, ['music'], 'workflow'));
  if (params.model) args.push('-m', sanitizeString(params.model, 'model'));
  if (params.genre) args.push('--genre', sanitizeString(params.genre, 'genre'));
  if (params.mood) args.push('--mood', sanitizeString(params.mood, 'mood'));
  if (params.tempo) args.push('--tempo', sanitizeString(params.tempo, 'tempo'));
  if (params.instruments) args.push('--instruments', sanitizeString(params.instruments, 'instruments'));
  if (params.lyrics) args.push('--lyrics', sanitizeString(params.lyrics, 'lyrics'));
  if (params.instrumental === true) args.push('--instrumental');
  else if (params.instrumental === false) args.push('--no-instrumental');
  if (params.bpm) args.push('--bpm', String(params.bpm));
  if (params.time_signature) args.push('--time-signature', sanitizeString(params.time_signature, 'time_signature'));
  if (params.language) args.push('--language', sanitizeString(params.language, 'language'));
  if (params.keyscale) args.push('--keyscale', sanitizeString(params.keyscale, 'keyscale'));
  if (params.composer_mode === true) args.push('--composer-mode');
  else if (params.composer_mode === false) args.push('--no-composer-mode');
  if (params.prompt_strength) args.push('--prompt-strength', String(params.prompt_strength));
  if (params.creativity) args.push('--creativity', String(params.creativity));
  if (params.shift) args.push('--audio-shift', String(params.shift));
  if (params.output_format) args.push('--audio-format', sanitizeString(params.output_format, 'output_format'));

  const duration = params.length || params.duration;
  if (duration) args.push('--duration', String(duration));
  if (params.count) args.push('-n', String(params.count));
  if (params.seed != null) args.push('-s', String(params.seed));
  if (params.output) args.push('-o', sanitizeString(params.output, 'output'));

  return runAndFormat(args, { timeoutMs: 600_000 });
}

async function handleListMedia(params) {
  const args = ['--list-media'];
  if (params.type) {
    args.push(validateEnum(params.type, ['images', 'audio', 'all'], 'type'));
  }
  const result = await runSogniGen(args, { timeoutMs: 10_000 });
  if (result.success === false) return formatError(result);
  const files = result.files || [];
  if (files.length === 0) {
    return { content: [{ type: 'text', text: `No ${result.mediaType || 'media'} files found.` }] };
  }
  const lines = files.map(f => `${f.name}  (${f.size} bytes, ${f.modified})\n  ${f.path}`);
  return { content: [{ type: 'text', text: `Recent ${result.mediaType || 'media'} (${files.length}):\n${lines.join('\n')}` }] };
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new Server(
  { name: 'sogni', version: SERVER_VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: params } = request.params;
  try {
    switch (name) {
      case 'generate_image':
        return await handleGenerateImage(params);
      case 'generate_video':
        return await handleGenerateVideo(params);
      case 'generate_song':
        return await handleGenerateSong(params);
      case 'edit_image':
        return await handleEditImage(params);
      case 'photobooth':
        return await handlePhotobooth(params);
      case 'check_balance':
        return await handleCheckBalance();
      case 'list_models':
        return handleListModels();
      case 'get_version':
        return await handleGetVersion();
      case 'extract_last_frame':
        return await handleExtractLastFrame(params);
      case 'concat_videos':
        return await handleConcatVideos(params);
      case 'list_media':
        return await handleListMedia(params);
      default:
        return {
          content: [{ type: 'text', text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const transport = new StdioServerTransport();
await server.connect(transport);
