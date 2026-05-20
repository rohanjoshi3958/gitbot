# Commit message proxy (private API key)

This server holds your **Anthropic API key** in environment variables. The VS Code extension calls this server instead of Anthropic directly, so users never need your key.

## Setup

```bash
cd server
cp .env.example .env
# Edit .env — set ANTHROPIC_API_KEY (required)
npm install
npm start
```

Server runs at `http://localhost:8787` by default.

## Production (Railway, Render, Fly.io, etc.)

1. Deploy this `server/` folder as a Node app.
2. Set environment variables in the host dashboard:
   - `ANTHROPIC_API_KEY` (secret)
   - `PROXY_ACCESS_TOKEN` (recommended — random string; not your Anthropic key)
3. Copy the public URL (e.g. `https://your-app.onrender.com`).
4. In the extension `package.json`, set default:
   - `gitCommitMessageButton.hostedProxyUrl` → your URL
   - `gitCommitMessageButton.hostedProxyAccessToken` → same as `PROXY_ACCESS_TOKEN` (optional gate; still not the Anthropic key)

Republish the extension after changing defaults.

## Security notes

- Never commit `.env` or put `ANTHROPIC_API_KEY` in the extension.
- `PROXY_ACCESS_TOKEN` can appear in the extension config — it only protects your proxy from casual abuse, not your Anthropic account if someone extracts it. Use rate limits and monitor usage.
- Diffs are sent to your server; disclose this in your marketplace README.

## Endpoints

- `GET /health` — liveness check
- `POST /api/commit-message` — body: change context JSON from extension

Optional header when `PROXY_ACCESS_TOKEN` is set:

`Authorization: Bearer <PROXY_ACCESS_TOKEN>`
