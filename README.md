# Git Commit Message Button (VS Code Extension)

Generate a detailed commit message with one click and auto-fill the Source Control input.

## Demo (video)

![Demo](./demo.gif)

## Features

- Adds `Generate Commit Message` command.
- Adds a status bar button: `Commit Msg`.
- Adds a Source Control title bar button.
- Reads git changes (staged, unstaged, untracked) and drafts a detailed message.

## AI setup (for extension authors)

Users do **not** need an Anthropic API key if you run the included **proxy server** with your key on the server only.

1. Deploy `server/` (see [server/README.md](./server/README.md)).
2. Set `ANTHROPIC_API_KEY` and `PROXY_ACCESS_TOKEN` in the host’s environment (never in the extension).
3. Before publishing, set defaults in `package.json`:
   - `gitCommitMessageButton.hostedProxyUrl` → your public URL
   - `gitCommitMessageButton.hostedProxyAccessToken` → same as server `PROXY_ACCESS_TOKEN`
   - `gitCommitMessageButton.generationMode` → `hosted` (default)

**Power users** can switch to `anthropic` mode and use their own `gitCommitMessageButton.anthropicApiKey`.
