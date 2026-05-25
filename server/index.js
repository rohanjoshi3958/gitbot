require("dotenv").config();

const cors = require("cors");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { buildCommitPrompt, sanitizeCommitMessage } = require("./prompt");

const PORT = Number(process.env.PORT) || 8787;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const PROXY_ACCESS_TOKEN = process.env.PROXY_ACCESS_TOKEN || "";
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001";
const ANTHROPIC_MAX_TOKENS = Number(process.env.ANTHROPIC_MAX_TOKENS) || 512;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS) || 60 * 60 * 1000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX) || 40;

if (!ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY. Copy server/.env.example to server/.env and set your key.");
  process.exit(1);
}

const app = express();
app.set("trust proxy", 1);
app.use(cors());
app.use(express.json({ limit: "600kb" }));

app.use(
  rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: "Rate limit exceeded. Try again later." }
  })
);

function requireProxyAuth(req, res, next) {
  if (!PROXY_ACCESS_TOKEN) {
    next();
    return;
  }
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== PROXY_ACCESS_TOKEN) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/api/commit-message", requireProxyAuth, async (req, res) => {
  try {
    const body = req.body || {};
    const {
      stagedFiles = [],
      unstagedFiles = [],
      untrackedFiles = [],
      diffText = "",
      includeBody = true,
      fileComparisons = []
    } = body;

    const prompt = buildCommitPrompt({
      stagedFiles,
      unstagedFiles,
      untrackedFiles,
      diffText,
      includeBody,
      fileComparisons
    });

    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: ANTHROPIC_MAX_TOKENS,
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }]
      })
    });

    if (!anthropicRes.ok) {
      const text = await anthropicRes.text();
      res.status(502).json({ error: `Anthropic error ${anthropicRes.status}`, detail: text.slice(0, 500) });
      return;
    }

    const data = await anthropicRes.json();
    const message = sanitizeCommitMessage(
      (data.content || [])
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n")
    );

    if (!message) {
      res.status(502).json({ error: "Empty response from Anthropic" });
      return;
    }

    res.json({ message });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error?.message || "Internal server error" });
  }
});

app.listen(PORT, () => {
  console.log(`Git commit message proxy listening on http://localhost:${PORT}`);
  if (PROXY_ACCESS_TOKEN) {
    console.log("Proxy access token required on requests.");
  } else {
    console.log("Warning: PROXY_ACCESS_TOKEN not set — endpoint is open aside from rate limits.");
  }
});
