<p align="center">
  <img src="https://raw.githubusercontent.com/Sogni-AI/openclaw-sogni-gen/main/docs/screenshot.jpg" alt="Telegram image render workflow" width="320" />
</p>

# Sogni Gen — AI Image & Video Generation

🎨 Generate **images and videos** using [Sogni AI](https://sogni.ai)'s decentralized GPU network.

Works as:
- an [OpenClaw](https://github.com/OpenClaw/OpenClaw) plugin (recommended)
- a skill source for Manus AI agent
- an [MCP server](https://modelcontextprotocol.io/) for **Claude Code** and **Claude Desktop**

## Quick Start (OpenClaw + Manus)

1. Create Sogni credentials (one-time): see [Setup](#setup).
2. For OpenClaw, install the plugin:

```bash
openclaw plugins install sogni-gen
```

3. For Manus AI agent, point it to this repository:

```
https://github.com/Sogni-AI/openclaw-sogni-gen
```

Then ask your agent:
- "Generate an image of a sunset over mountains"
- "Make a video of a cat playing piano"
- "Edit this image to add a rainbow"
- "Check my Sogni balance"
- "Turn my selfie into James bond using photobooth"
- "Animate the last 3 images you generated together"

## OpenClaw Installation (Recommended)

### Plugin Install

```bash
openclaw plugins install sogni-gen
```

The installed plugin loads its behavior from [`SKILL.md`](./SKILL.md) via [`openclaw.plugin.json`](./openclaw.plugin.json).

### Optional Install Helper

[`llm.txt`](https://raw.githubusercontent.com/Sogni-AI/openclaw-sogni-gen/main/llm.txt) is now only a lightweight install/setup helper. It is not the primary behavior source for the installed OpenClaw plugin.

### Manual Installation

```bash
git clone git@github.com:Sogni-AI/openclaw-sogni-gen.git
cd openclaw-sogni-gen
npm install
```

### OpenClaw Config Defaults

If OpenClaw loads this plugin, `sogni-gen` reads defaults from your OpenClaw config:

```json
{
  "plugins": {
    "entries": {
      "sogni-gen": {
        "enabled": true,
        "config": {
          "defaultImageModel": "z_image_turbo_bf16",
          "defaultEditModel": "qwen_image_edit_2511_fp8_lightning",
          "defaultPhotoboothModel": "coreml-sogniXLturbo_alpha1_ad",
          "videoModels": {
            "t2v": "wan_v2.2-14b-fp8_t2v_lightx2v",
            "i2v": "wan_v2.2-14b-fp8_i2v_lightx2v",
            "s2v": "wan_v2.2-14b-fp8_s2v_lightx2v",
            "ia2v": "ltx2-19b-fp8_ia2v_distilled",
            "a2v": "ltx2-19b-fp8_a2v_distilled",
            "v2v": "ltx2-19b-fp8_v2v_distilled",
            "animate-move": "wan_v2.2-14b-fp8_animate-move_lightx2v",
            "animate-replace": "wan_v2.2-14b-fp8_animate-replace_lightx2v"
          },
          "defaultVideoWorkflow": "t2v",
          "defaultNetwork": "fast",
          "defaultTokenType": "spark",
          "seedStrategy": "prompt-hash",
          "modelDefaults": {
            "flux1-schnell-fp8": { "steps": 4, "guidance": 3.5 },
            "flux2_dev_fp8": { "steps": 20, "guidance": 7.5 }
          },
          "defaultWidth": 768,
          "defaultHeight": 768,
          "defaultCount": 1,
          "defaultFps": 16,
          "defaultDurationSec": 5,
          "defaultImageTimeoutSec": 30,
          "defaultVideoTimeoutSec": 300,
          "credentialsPath": "~/.config/sogni/credentials",
          "lastRenderPath": "~/.config/sogni/last-render.json",
          "mediaInboundDir": "~/.clawdbot/media/inbound"
        }
      }
    }
  }
}
```

CLI flags always override these defaults. If your OpenClaw config lives elsewhere, set `OPENCLAW_CONFIG_PATH`. Seed strategies: `prompt-hash` (deterministic) or `random`.

## Setup

1. Create a Sogni account at https://app.sogni.ai/
2. Create credentials file:

```bash
mkdir -p ~/.config/sogni
cat > ~/.config/sogni/credentials << 'EOF'
SOGNI_API_KEY=your_api_key
# or:
# SOGNI_USERNAME=your_username
# SOGNI_PASSWORD=your_password
EOF
chmod 600 ~/.config/sogni/credentials
```

You can also skip the file and set `SOGNI_API_KEY`, or `SOGNI_USERNAME` + `SOGNI_PASSWORD`, in your environment.

### Filesystem Paths and Overrides

By default, the runtime reads/writes:

- Credentials file: `~/.config/sogni/credentials` (read)
- Last render metadata: `~/.config/sogni/last-render.json` (read/write)
- OpenClaw config: `~/.openclaw/openclaw.json` (read)
- Inbound media listing (`--list-media`): `~/.clawdbot/media/inbound` (read)
- MCP local result copies: `~/Downloads/sogni` (write)

Override with environment variables:

- `SOGNI_CREDENTIALS_PATH`
- `SOGNI_LAST_RENDER_PATH`
- `SOGNI_MEDIA_INBOUND_DIR`
- `OPENCLAW_CONFIG_PATH`
- `SOGNI_DOWNLOADS_DIR` (MCP)
- `SOGNI_MCP_SAVE_DOWNLOADS=0` (disable MCP local file writes)
- `SOGNI_ALLOWED_DOWNLOAD_HOSTS` (comma-separated HTTPS host suffixes the MCP server may auto-download locally)

## Claude Code and Claude Desktop (Optional)

### Claude Code (one command)

```bash
claude mcp add sogni -- npx -y -p sogni-gen sogni-gen-mcp
```

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "sogni": {
      "command": "npx",
      "args": ["-y", "-p", "sogni-gen", "sogni-gen-mcp"]
    }
  }
}
```

Restart Claude Desktop after saving.

### Global npm Install (CLI + MCP)

```bash
npm install -g sogni-gen
sogni-gen --version
```

If `sogni-gen-mcp` is on your `PATH`, you can register it directly:

```bash
# Claude Code using globally installed binary
claude mcp add sogni -- sogni-gen-mcp
```

Claude Desktop config using global binary:

```json
{
  "mcpServers": {
    "sogni": {
      "command": "sogni-gen-mcp",
      "args": []
    }
  }
}
```

## Usage

```bash
# Generate image, get URL
node sogni-gen.mjs "a dragon eating tacos"

# Save to file
node sogni-gen.mjs -o dragon.png "a dragon eating tacos"

# JSON output
node sogni-gen.mjs --json "a dragon eating tacos"

# Check token balances (no prompt required)
node sogni-gen.mjs --balance

# Check token balances with JSON output
node sogni-gen.mjs --json --balance

# Different model
node sogni-gen.mjs -m flux1-schnell-fp8 "a dragon eating tacos"

# JPG output
node sogni-gen.mjs --output-format jpg -o dragon.jpg "a dragon eating tacos"

# Photobooth (face transfer)
node sogni-gen.mjs --photobooth --ref face.jpg "80s fashion portrait"
node sogni-gen.mjs --photobooth --ref face.jpg -n 4 "LinkedIn professional headshot"

# Image edit with LoRA
node sogni-gen.mjs -c subject.jpg --lora sogni_lora_v1 --lora-strength 0.7 \
  "add a neon cyberpunk glow"

# Multiple angles (Qwen + Multiple Angles LoRA)
node sogni-gen.mjs --multi-angle -c subject.jpg \
  --azimuth front-right --elevation eye-level --distance medium \
  --angle-strength 0.9 \
  "studio portrait, same person"

# 360 turntable (8 azimuths)
node sogni-gen.mjs --angles-360 -c subject.jpg --distance medium --elevation eye-level \
  "studio portrait, same person"

# 360 turntable video (looping mp4, uses i2v between angles; requires ffmpeg)
node sogni-gen.mjs --angles-360 --angles-360-video /tmp/turntable.mp4 \
  -c subject.jpg --distance medium --elevation eye-level \
  "studio portrait, same person"

# Text-to-video (t2v)
node sogni-gen.mjs --video "ocean waves at sunset"

# Image-to-video (i2v)
node sogni-gen.mjs --video --ref cat.jpg "gentle camera pan"

# Sound-to-video (s2v)
node sogni-gen.mjs --video --ref face.jpg --ref-audio speech.m4a \
  -m wan_v2.2-14b-fp8_s2v_lightx2v "lip sync talking head"

# Image+audio-to-video (ia2v, LTX)
node sogni-gen.mjs --video --workflow ia2v --ref cover.jpg --ref-audio song.mp3 \
  "music video with synchronized motion"

# Audio-to-video (a2v, LTX)
node sogni-gen.mjs --video --workflow a2v --ref-audio song.mp3 \
  "abstract audio-reactive visualizer"

# LTX-2.3 text-to-video
node sogni-gen.mjs --video -m ltx23-22b-fp8_t2v_distilled --duration 20 \
  "A wide cinematic aerial shot opens over steep tropical cliffs at golden hour, warm sunlight grazing the rock faces while sea mist drifts above the water below. Palm trees bend gently along the ridge as waves roll against the shoreline, leaving bright bands of foam across the dark stone. The camera glides forward in one continuous pass, revealing more of the coastline as sunlight flickers across wet surfaces and distant birds wheel through the haze. The scene holds a calm, upscale travel-film mood with smooth stabilized motion and crisp environmental detail."

# Animate (motion transfer)
node sogni-gen.mjs --video --ref subject.jpg --ref-video motion.mp4 \
  --workflow animate-move "transfer motion"

# Estimate video cost (requires --steps)
node sogni-gen.mjs --video --estimate-video-cost --steps 20 \
  -m wan_v2.2-14b-fp8_t2v_lightx2v "ocean waves at sunset"
```

## LTX-2.3 Prompting Guide

When you use `ltx23-22b-fp8_t2v_distilled`, do not feed it short tag prompts like `"cinematic drone shot over tropical cliffs"`. LTX-2.3 renders more reliably from a dense natural-language scene description.

- Write one unbroken paragraph with no line breaks, bullets, headers, or tag blocks.
- Use 4-8 flowing present-tense sentences describing one continuous shot, not a montage.
- Start with shot scale and scene identity, then cover environment, time of day, textures, and named light sources.
- Keep characters and objects concrete and stable. Describe one main action thread from start to finish.
- If the user wants dialogue, weave it into the prose with the speaker and delivery identified inline.
- Express mood through visible behavior, motion, and sound cues instead of vague adjectives.
- Use positive phrasing. Avoid script formatting, negative prompts, on-screen text/logo requests, and generic filler words like "beautiful" or "nice".
- Match scene density to clip length. For the default short clips, describe one main beat rather than several unrelated actions.

Example rewrite:

```text
User ask: "make a 4k video of a woman in a neon alley"

LTX-2.3 prompt: "A medium cinematic shot frames a woman in her 30s standing in a rain-soaked neon alley at night, violet and amber signs reflecting across the wet pavement while warm steam drifts from street vents. She wears a dark trench coat with damp strands of black hair clinging near her cheek as light glances across the fabric texture and the brick walls behind her. She turns toward the camera and steps forward with measured focus, one hand tightening around the strap of her bag while rain taps softly on the metal fire escape and a distant train hum rolls through the block. The camera performs a slow push-in as her jaw sets and her breathing steadies, maintaining smooth stabilized motion and a tense urban-thriller mood."
```

## Photobooth (Face Transfer)

Generate stylized portraits from a face photo using InstantID ControlNet:

```bash
# Basic photobooth
node sogni-gen.mjs --photobooth --ref face.jpg "80s fashion portrait"

# Multiple outputs
node sogni-gen.mjs --photobooth --ref face.jpg -n 4 "LinkedIn professional headshot"

# Custom ControlNet tuning
node sogni-gen.mjs --photobooth --ref face.jpg --cn-strength 0.6 --cn-guidance-end 0.5 "oil painting"

# Custom model
node sogni-gen.mjs --photobooth --ref face.jpg -m coreml-dreamshaperXL_v21TurboDPMSDE "anime style"
```

Uses SDXL Turbo (`coreml-sogniXLturbo_alpha1_ad`) at 1024x1024 by default. The face image is passed via `--ref` and styled according to the prompt. Cannot be combined with `--video` or `-c/--context`.

Multi-angle mode auto-builds the `<sks>` prompt and applies the `multiple_angles` LoRA.
`--angles-360-video` generates i2v clips between consecutive angles (including last→first) and concatenates them with ffmpeg for a seamless loop.
`--balance` / `--balances` does not require a prompt and exits after printing current `SPARK` and `SOGNI` balances.

## Video Sizing Rules (Aspect Ratios)

- WAN models use dimensions divisible by 16, min 480px, max 1536px.
- LTX family models (`ltx2-*`, `ltx23-*`) use dimensions divisible by 64. A practical default range is 768px to 1920px.
- The script auto-normalizes video sizes to satisfy those constraints.
- For i2v (and any workflow using `--ref` / `--ref-end`), the client wrapper resizes the reference image with a strict aspect-fit (`fit: inside`) and then uses the *resized reference dimensions* as the final video size. Because that resize uses rounding, a “valid” requested size can still produce an invalid final size (example: `1024x1536` requested, but ref becomes `1024x1535`).
- `sogni-gen` detects this for local refs and will auto-adjust the requested size to a nearby safe size so the resized reference is divisible by 16.
- If you want the script to fail instead of auto-adjusting, pass `--strict-size` and it will print a suggested size.

## Error Reporting

- Exit code is non-zero on failure.
- Default output is human-readable errors on stderr.
- With `--json`, the script prints a single JSON object to stdout for both success and failure.
  - For `--balance`, success output looks like: `{"success": true, "type": "balance", "spark": <number|null>, "sogni": <number|null>, ...}`
  - On failure: `{"success": false, "error": "...", "errorCode": "...?", "errorDetails": {...}?, "hint": "...?", "context": {...}?}`
- When invoked by OpenClaw, errors are always returned as JSON (and also logged to stderr for humans).

## Options

```
-o, --output <path>   Save image to file
-m, --model <id>      Model (default: z_image_turbo_bf16)
-w, --width <px>      Width (default: 512)
-h, --height <px>     Height (default: 512)
-n, --count <num>     Number of images (default: 1)
-t, --timeout <sec>   Timeout (default: 30)
-s, --seed <num>      Specific seed
--last-seed           Reuse last seed
--seed-strategy <s>   random|prompt-hash
--multi-angle         Multiple angles LoRA mode (Qwen Image Edit)
--angles-360          Generate 8 azimuths (front -> front-left)
--angles-360-video    Assemble a looping 360 mp4 using i2v between angles (requires ffmpeg)
--azimuth <key>       front|front-right|right|back-right|back|back-left|left|front-left
--elevation <key>     low-angle|eye-level|elevated|high-angle
--distance <key>      close-up|medium|wide
--angle-strength <n>  LoRA strength for multiple_angles (default: 0.9)
--angle-description <text>  Optional subject description
--output-format <f>   Image output format: png|jpg
--steps <num>         Override steps (model-dependent)
--guidance <num>      Override guidance (model-dependent)
--sampler <name>      Sampler (model-dependent)
--scheduler <name>    Scheduler (model-dependent)
--lora <id>           LoRA id (repeatable, edit only)
--loras <ids>         Comma-separated LoRA ids
--lora-strength <n>   LoRA strength (repeatable)
--lora-strengths <n>  Comma-separated LoRA strengths
--token-type <type>   spark|sogni
--balance, --balances Show SPARK/SOGNI balances and exit
--version, -V         Show sogni-gen version and exit
--video, -v           Generate video instead of image
--workflow <type>     t2v|i2v|s2v|animate-move|animate-replace
--fps <num>           Frames per second (video)
--duration <sec>      Video duration in seconds
--frames <num>        Override total frames (video)
--auto-resize-assets  Auto-resize video reference assets
--no-auto-resize-assets  Disable auto-resize for video assets
--estimate-video-cost Estimate video cost and exit (requires --steps)
--photobooth          Face transfer mode (InstantID + SDXL Turbo)
--cn-strength <n>     ControlNet strength (default: 0.8)
--cn-guidance-end <n> ControlNet guidance end point (default: 0.3)
--ref <path|url>      Reference image for i2v/s2v/animate/photobooth
--ref-end <path|url>  End frame for i2v interpolation
--ref-audio <path>    Reference audio for s2v
--ref-video <path>    Reference video for animate workflows
-c, --context <path>  Context image(s) for editing (repeatable)
--last-image          Use last image as context/ref
--json                JSON output
--strict-size         Do not auto-adjust i2v video size for reference resizing constraints
-q, --quiet           Suppress progress
```

## Models

| Model | Speed | Notes |
|-------|-------|-------|
| `z_image_turbo_bf16` | ~5-10s | Default, general purpose |
| `flux1-schnell-fp8` | ~3-5s | Fast iterations |
| `flux2_dev_fp8` | ~2min | High quality |
| `chroma-v.46-flash_fp8` | ~30s | Balanced |
| `qwen_image_edit_2511_fp8` | ~30s | Image editing with context |
| `qwen_image_edit_2511_fp8_lightning` | ~8s | Fast image editing |
| `coreml-sogniXLturbo_alpha1_ad` | Fast | Photobooth face transfer (SDXL Turbo) |
| `wan_v2.2-14b-fp8_t2v_lightx2v` | ~5min | Text-to-video |
| `wan_v2.2-14b-fp8_i2v_lightx2v` | ~3-5min | Image-to-video |
| `wan_v2.2-14b-fp8_s2v_lightx2v` | ~5min | Sound-to-video |
| `wan_v2.2-14b-fp8_animate-move_lightx2v` | ~5min | Animate-move |
| `wan_v2.2-14b-fp8_animate-replace_lightx2v` | ~5min | Animate-replace |
| `ltx2-19b-fp8_t2v_distilled` | ~2-3min | LTX-2 text-to-video |
| `ltx2-19b-fp8_i2v_distilled` | ~2-3min | LTX-2 image-to-video |
| `ltx2-19b-fp8_ia2v_distilled` | ~2-3min | LTX-2 image+audio-to-video |
| `ltx2-19b-fp8_a2v_distilled` | ~2-3min | LTX-2 audio-to-video |
| `ltx2-19b-fp8_v2v_distilled` | ~3min | LTX-2 video-to-video with ControlNet |
| `ltx23-22b-fp8_t2v_distilled` | ~2-3min | LTX-2.3 text-to-video |

## License

MIT
