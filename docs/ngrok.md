# Ngrok Integration Guide

This guide explains how to expose your local Stake PF Replay services over the public internet with [ngrok](https://ngrok.com). The goal is to let remote AI coding agents (running in WSL2 or elsewhere), teammates, or external tools reach your backend API, React dev server, and optional live ingest endpoint without running the Wails desktop shell.

## When to use ngrok
- Share your local API/UI with remote agents that cannot interact with the Wails window.
- Test the React UI on physical devices (phones/tablets) without rebuilding the desktop app.
- Allow webhooks or bots (e.g., Antebot) to post into your local live ingest endpoint.
- Demo in-progress work to teammates with minimal setup.

Avoid leaving tunnels up longer than necessary—stop them once the task finishes.

## Local services to tunnel

| Target | Default Port | How to start | Notes |
| ------ | ------------ | ------------ | ----- |
| Backend API | `8080` (`PORT` override supported) | `make -C backend run` (WSL2 recommended) | Runs pure Go API without Wails; ideal for agents. |
| Frontend dev server | `5173` (Vite default) | `npm --prefix frontend run dev -- --host --port 5173` | `--host` lets external clients reach it; choose another port if 5173 is busy. |
| Live ingest HTTP server | `17888` in the desktop app (`LIVE_INGEST_PORT` override supported) | Start the desktop app or call `internal/livehttp` bootstrapper | Requires `LIVE_INGEST_TOKEN` when exposed. The lower-level server falls back to `8077` only if constructed with an invalid port. |

> **Windows vs WSL2:** Run ngrok from the environment that hosts each service. For backend/UI development this is usually WSL2 Ubuntu; the desktop ingest endpoint continues to run on Windows via Wails.

## Configure ngrok

1. Install ngrok on both Windows and WSL2 (if you use both):
   - Windows (PowerShell): `choco install ngrok` or download the MSI from the ngrok dashboard.
   - WSL2 Ubuntu: `sudo snap install ngrok` *or* `curl -s https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc > /dev/null && echo "deb https://ngrok-agent.s3.amazonaws.com/ buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list && sudo apt update && sudo apt install ngrok`
2. Authenticate once per machine: `ngrok config add-authtoken <YOUR_TOKEN>`
3. Create an ngrok config tailored to this repo:
   - **WSL2 path:** `~/.config/ngrok/ngrok.yml`
   - **Windows path:** `%HOMEPATH%\.ngrok2\ngrok.yml`

```yaml
# docs/ngrok.yml.example
version: "2"
authtoken: YOUR_NGROK_AUTHTOKEN

tunnels:
  api:
    addr: 8080            # matches make -C backend run
    proto: http
    schemes: [https]

  ui:
    addr: 5173            # Vite dev server (ensure --host)
    proto: http
    host_header: rewrite  # fixes websocket/HMR host checks

  ingest:
    addr: 17888           # Live ingest from desktop
    proto: http
    basic_auth:
      - "agent:<GENERATE_A_PASSWORD>"   # optional extra guard in addition to LIVE_INGEST_TOKEN
```

Copy this example into the appropriate config file and adjust:
- Replace `YOUR_NGROK_AUTHTOKEN` (or omit if you already set it globally).
- Remove tunnels you do not need, or add reserved `domain:` entries if you pay for static subdomains.
- Update ports if you override `PORT`, `LIVE_INGEST_PORT`, or Vite’s `--port`.

## Starting tunnels

1. **Backend (WSL2)**
   ```bash
   # From /home/<user>/.dev/stake-pf-replay-go
   make -C backend run
   ```
   In a second WSL2 shell:
   ```bash
   ngrok start api
   ```
   Share the printed `https://<subdomain>.ngrok.io` with your AI agent or teammate.

2. **Frontend UI (WSL2)**
   ```bash
   npm --prefix frontend run dev -- --host --port 5173
   ngrok start ui
   ```
   The ngrok URL serves the React app, which communicates with the backend tunnel (update `.env` or config to point to the tunneled API if needed).

3. **Live ingest (Windows desktop)**
   - Set a token before launching Wails: in PowerShell, `set LIVE_INGEST_TOKEN=choose-a-long-secret` then run `wails dev` or your production build.
   - Start the tunnel from PowerShell (desktop side) or WSL2 (if the ingest process runs there):
     ```powershell
     ngrok start ingest
     ```
   - Callers must supply both `X-Ingest-Token: <token>` and the optional ngrok `basic_auth` credentials if you configured them.

4. **Multiple tunnels at once**
   ```bash
   ngrok start --all
   ```
   Use `CTRL+C` to stop all tunnels when done.

## Workflow tips for AI coding agents

- Share the ngrok URLs (API/UI) in the agent prompt or environment so the agent can issue HTTP calls or drive browser automation.
- If the agent runs inside WSL2 (like Codex CLI), starting the backend and ngrok from WSL2 means no extra firewall tweaks.
- For scripting, you can export the public URL with `ngrok api`:
  ```bash
  # Example: capture the API tunnel URL for tests
  api_url=$(ngrok api --request 'GET /api/tunnels' | jq -r '.tunnels[] | select(.name=="api") | .public_url')
  ```
- Remember to update any hard-coded `localhost` references in temporary scripts or Postman collections to match the ngrok domains during remote sessions.

## Security checklist

- Keep tunnels short-lived; stop them after demos or agent runs.
- Always require `LIVE_INGEST_TOKEN` when exposing ingest, and consider ngrok’s `basic_auth` or IP restrictions.
- Do not expose SQLite databases (`data.db*`) or other sensitive files via ngrok file tunnels.
- Monitor ngrok’s activity log for unexpected requests during sessions.

## Troubleshooting

- **Vite hot module reload fails**: ensure you passed `--host` and added `host_header: rewrite` in the config.
- **Port already in use**: pick another port (e.g., `PORT=8081 make -C backend run`) and update `addr` in the config.
- **Windows firewall prompts**: allow ngrok to communicate on private networks; you can deny public network access if you only need outbound tunnels.
- **Agent hitting HTTP while backend expects HTTPS**: ngrok issues HTTPS URLs by default; use them to avoid mixed-content issues in browsers.

For quick reference, keep this document alongside `AGENTS.md` and share the example config with anyone spinning up a new machine.
