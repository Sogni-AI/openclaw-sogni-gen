# OpenClaw Sogni-Gen EC2 Setup Guide

This guide provides step-by-step instructions for deploying and running your OpenClaw agent 24/7 on an AWS EC2 instance.

## 1. Provision the EC2 Instance

1. Log in to the [AWS Management Console](https://console.aws.amazon.com/ec2/).
2. Navigate to **EC2** and click **Launch Instance**.
3. **Name**: Enter a name (e.g., `openclaw-bot`).
4. **Application and OS Images (Amazon Machine Image)**: Select **Ubuntu** and choose **Ubuntu Server 24.04 LTS (HVM), SSD Volume Type**.
5. **Instance Type**: Select **t3.small** or **t3.medium**. (Since the heavy lifting is done by Sogni's API via MCP, CPU requirements are moderate, but Node.js runs better with >= 2GB RAM).
6. **Key Pair (login)**: Create a new key pair (RSA, `.pem`) or select an existing one. **Download the `.pem` file and keep it secure.** You will need it to connect.
7. **Network Settings**:
   - Create a new security group.
   - **Allow SSH traffic** from **Anywhere** (or your specific IP for better security).
8. Click **Launch instance**.

## 2. Connect to Your Instance

Open your terminal (Mac/Linux) or PowerShell/Git Bash (Windows) and connect using SSH. Replace `/path/to/your-key.pem` and `your-instance-ip` with your actual files and instance public IP address.

```bash
# Set appropriate permissions for the key file (Mac/Linux only)
chmod 400 /path/to/your-key.pem

# Connect to the instance
ssh -i /path/to/your-key.pem ubuntu@your-instance-ip
```

## 3. Install System Dependencies

Once connected, update the system and install Node.js (v20+ recommended), Git, and FFmpeg (required by the Sogni MCP server for video/audio manipulation).

```bash
# Update package list
sudo apt update && sudo apt upgrade -y

# Install FFmpeg
sudo apt install -y ffmpeg

# Install Node.js v20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs git
```

## 4. Clone and Prepare the Repository

Clone your customized OpenClaw Sogni repository from GitHub. Ensure you use your exact repository URL.

```bash
# Clone the repository
git clone https://github.com/your-username/openclaw-sogni-gen.git
cd openclaw-sogni-gen

# Install project dependencies
npm install
```

## 5. Configure Credentials and Profiles

Your agent needs the OpenClaw configuration and Sogni credentials to operate. Since this is a new machine, you need to recreate the configuration files.

### 5.1. Sogni Credentials

Create the Sogni configuration directory and credentials file:

```bash
mkdir -p ~/.config/sogni
nano ~/.config/sogni/credentials
```

Paste your credentials into the `nano` editor:
```env
SOGNI_API_KEY=your_sogni_api_key_here
```
*(Save and exit by pressing `Ctrl+O`, `Enter`, then `Ctrl+X`)*

Secure the file:
```bash
chmod 600 ~/.config/sogni/credentials
```

### 5.2. OpenClaw Configuration

OpenClaw requires specific configurations to use the Sogni Qwen 3.5 model. You will need to recreate or upload your `models.json`, `auth-profiles.json`, and `openclaw.json` files to the `~/.openclaw` directories on the server.

The easiest way is to let OpenClaw initialize its directories first:

```bash
npx openclaw setup
```

Then, manually recreate the configuration files that you successfully set up locally. 

**a. Create `~/.openclaw/agents/main/agent/models.json`**:
```bash
nano ~/.openclaw/agents/main/agent/models.json
```
Ensure it includes the Sogni provider and models, similar to your local setup:
```json
{
  "$schema": "https://schema.openclaw.dev/v1/models/schema",
  "providers": {
    "sogni": {
      "baseUrl": "https://api.sogni.ai/rest/v1"
    }
  },
  "models": {
    "sogni/qwen3.5-35b-a3b-abliterated-gguf-q4km": {
      "id": "sogni/qwen3.5-35b-a3b-abliterated-gguf-q4km",
      "vision": false,
      "maxOutputItems": 4096,
      "maxContextItems": 8192,
      "tier": 2
    }
  }
}
```

**b. Create `~/.openclaw/agents/main/agent/auth-profiles.json`**:
```bash
nano ~/.openclaw/agents/main/agent/auth-profiles.json
```
```json
{
  "$schema": "https://schema.openclaw.dev/v1/auth-profiles/schema",
  "profiles": [
    {
      "id": "sogni-default",
      "provider": "sogni",
      "parameters": {
        "apiKey": { "source": "env", "key": "SOGNI_API_KEY" }
      }
    }
  ]
}
```
*(Make sure to export `SOGNI_API_KEY` in your environment or rely on the `~/.config/sogni/credentials` check if the Sogni SDK handles it directly).*

**c. Configure OpenClaw entry point (`~/.openclaw/openclaw.json`)**:
Make sure OpenClaw points to your Sogni LLM as the primary engine.

**d. Re-add the Discord Gateway**:
If you previously had Discord integrated, add it back:
```bash
npx openclaw add discord
```

## 6. Run the Agent 24/7 with PM2

To ensure the bot continues running after you close your SSH session and automatically restarts if it crashes or the server reboots, use PM2.

```bash
# Install PM2 globally
sudo npm install -g pm2

# Start the OpenClaw gateway using PM2
pm2 start openclaw --name "sogni-bot" -- gateway

# Save the current list of PM2 processes
pm2 save

# Setup PM2 to start on system boot
pm2 startup
```
*(Follow the command outputted by `pm2 startup` and execute it)*

## 7. Monitoring and Logs

You can check the operational status and logs of your bot using PM2.

```bash
# View the status of your bot
pm2 status

# View the live logs
pm2 logs sogni-bot

# Restart the bot
pm2 restart sogni-bot

# Stop the bot
pm2 stop sogni-bot
```

## Troubleshooting

- **Audio/Video MCP Tools fail**: Verify that FFmpeg is installed (`ffmpeg -version`) and that the `sogni-gen` MCP server was correctly resolved via the plugin execution context.
- **Bot doesn't reply in Discord**: Ensure the Discord bot token is exported or configured correctly in your `auth-profiles.json` or `.env` file before running the PM2 task. You might want to pass the environment variables explicitly:
  ```bash
  DISCORD_TOKEN="your_token" pm2 restart sogni-bot --update-env
  ```
- **"Provide API key" loop**: Ensure your Sogni credentials file is at `~/.config/sogni/credentials` with permissions `600`.
