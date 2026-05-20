const vscode = require("vscode");
const cp = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const { buildCommitPrompt, sanitizeCommitMessage } = require("./prompt");

let extensionInstallPath = "";

function loadServerEnv(extensionPath) {
  const envPath = path.join(extensionPath, "server", ".env");
  if (!fs.existsSync(envPath)) {
    return {};
  }
  const env = {};
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      continue;
    }
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

function resolveAiSettings(config) {
  const serverEnv = loadServerEnv(extensionInstallPath);
  const anthropicApiKey =
    config.get("anthropicApiKey", "") || serverEnv.ANTHROPIC_API_KEY || "";
  let hostedProxyUrl = String(config.get("hostedProxyUrl", "")).trim().replace(/\/$/, "");
  const hostedProxyAccessToken =
    config.get("hostedProxyAccessToken", "") || serverEnv.PROXY_ACCESS_TOKEN || "";

  if (!hostedProxyUrl && serverEnv.ANTHROPIC_API_KEY) {
    const port = serverEnv.PORT || "8787";
    hostedProxyUrl = `http://127.0.0.1:${port}`;
  }

  return { anthropicApiKey, hostedProxyUrl, hostedProxyAccessToken, serverEnv };
}

function activate(context) {
  extensionInstallPath = context.extensionPath;
  const disposable = vscode.commands.registerCommand(
    "gitCommitMessageButton.generateCommitMessage",
    async () => {
      try {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
          vscode.window.showErrorMessage("Open a git project folder first.");
          return;
        }

        const cwd = workspaceFolder.uri.fsPath;
        if (!(await isGitRepo(cwd))) {
          vscode.window.showErrorMessage("Current workspace is not a git repository.");
          return;
        }

        const staged = await runGit(["diff", "--staged", "--name-only"], cwd);
        const unstaged = await runGit(["diff", "--name-only"], cwd);
        const untracked = await runGit(["ls-files", "--others", "--exclude-standard"], cwd);

        if (!staged.stdout.trim() && !unstaged.stdout.trim() && !untracked.stdout.trim()) {
          vscode.window.showInformationMessage("No changes found to describe.");
          return;
        }

        const maxDiffBytes = vscode.workspace
          .getConfiguration("gitCommitMessageButton")
          .get("maxDiffBytes", 120000);
        const includeBody = vscode.workspace
          .getConfiguration("gitCommitMessageButton")
          .get("includeBody", true);
        const config = vscode.workspace.getConfiguration("gitCommitMessageButton");
        const generationMode = config.get("generationMode", "hosted");
        const useAnthropic = config.get("useAnthropic", true);
        const { anthropicApiKey, hostedProxyUrl, hostedProxyAccessToken } =
          resolveAiSettings(config);

        const diffResult = await runGit(["diff", "--staged", "--", "."], cwd, maxDiffBytes);
        const fallbackDiff = diffResult.stdout.trim()
          ? diffResult.stdout
          : (await runGit(["diff", "--", "."], cwd, maxDiffBytes)).stdout;
        const changeContext = {
          stagedFiles: toFileList(staged.stdout),
          unstagedFiles: toFileList(unstaged.stdout),
          untrackedFiles: toFileList(untracked.stdout),
          diffText: fallbackDiff,
          includeBody,
          fileComparisons: await buildFileComparisons(
            cwd,
            unique([
              ...toFileList(staged.stdout),
              ...toFileList(unstaged.stdout),
              ...toFileList(untracked.stdout)
            ])
          )
        };

        let message = "";
        let generatedBy = "local";

        if (generationMode === "hosted" && hostedProxyUrl) {
          try {
            message = await generateCommitMessageViaProxy(
              changeContext,
              hostedProxyUrl,
              hostedProxyAccessToken
            );
            generatedBy = "ai";
          } catch (proxyError) {
            if (anthropicApiKey) {
              try {
                message = await generateCommitMessageWithAnthropic(
                  changeContext,
                  anthropicApiKey
                );
                generatedBy = "claude";
              } catch (_directError) {
                vscode.window.showWarningMessage(
                  `Hosted AI failed, using local fallback: ${proxyError?.message || proxyError}`
                );
              }
            } else {
              vscode.window.showWarningMessage(
                `Hosted AI failed, using local fallback: ${proxyError?.message || proxyError}`
              );
            }
          }
        } else if (anthropicApiKey && (generationMode === "anthropic" || useAnthropic)) {
          try {
            message = await generateCommitMessageWithAnthropic(
              changeContext,
              anthropicApiKey
            );
            generatedBy = "claude";
          } catch (aiError) {
            vscode.window.showWarningMessage(
              `Anthropic generation failed, using local fallback: ${aiError?.message || aiError}`
            );
          }
        } else if (generationMode === "hosted" && !hostedProxyUrl) {
          vscode.window.showWarningMessage(
            "Hosted mode: set hostedProxyUrl, add server/.env, or run the proxy (npm start in server/). Using local fallback."
          );
        }

        if (!message) {
          message = generateCommitMessage(changeContext);
        }

        const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports;
        const api = gitExtension?.getAPI(1);
        const repo =
          api?.repositories?.find(
            (r) => path.resolve(r.rootUri.fsPath) === path.resolve(cwd)
          ) || api?.repositories?.[0];

        if (repo?.inputBox) {
          repo.inputBox.value = message;
          vscode.window.showInformationMessage(
            `Commit message generated in Source Control (${generatedBy}).`
          );
        } else {
          await vscode.env.clipboard.writeText(message);
          vscode.window.showInformationMessage(
            `Could not locate SCM input. Message copied to clipboard (${generatedBy}).`
          );
        }
      } catch (error) {
        vscode.window.showErrorMessage(
          `Failed to generate message: ${error?.message || String(error)}`
        );
      }
    }
  );

  const statusButton = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Left,
    100
  );
  statusButton.command = "gitCommitMessageButton.generateCommitMessage";
  statusButton.text = "$(edit) Commit Msg";
  statusButton.tooltip = "Generate a detailed git commit message";
  statusButton.show();

  context.subscriptions.push(disposable, statusButton);
}

function deactivate() {}

async function isGitRepo(cwd) {
  const result = await runGit(["rev-parse", "--is-inside-work-tree"], cwd);
  return result.code === 0 && result.stdout.trim() === "true";
}

function runGit(args, cwd, maxBuffer = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    cp.execFile(
      "git",
      args,
      { cwd, maxBuffer, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          const err = new Error(stderr?.trim() || error.message);
          err.code = error.code;
          reject(err);
          return;
        }
        resolve({ stdout, stderr, code: 0 });
      }
    );
  });
}

function toFileList(content) {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function generateCommitMessage({
  stagedFiles,
  unstagedFiles,
  untrackedFiles,
  diffText,
  includeBody,
  fileComparisons
}) {
  const allFiles = unique([...stagedFiles, ...unstagedFiles, ...untrackedFiles]);
  const detectedType = detectType(diffText, allFiles);
  const areaHint = guessArea(allFiles);
  const subject = `${detectedType}${areaHint ? `(${areaHint})` : ""}: update ${summarizeTarget(allFiles)}`;

  if (!includeBody) {
    return trimLength(subject, 72);
  }

  const summary = buildNarrativeSummary({
    stagedFiles,
    unstagedFiles,
    untrackedFiles,
    diffText,
    allFiles,
    fileComparisons
  });

  return `${trimLength(subject, 72)}

${summary}`.trim();
}

function detectType(diffText, files) {
  const text = diffText.toLowerCase();
  if (text.includes("fix") || text.includes("bug") || text.includes("error")) return "fix";
  if (files.some((f) => /readme|docs?|\.md$/i.test(f))) return "docs";
  if (files.some((f) => /test|spec/i.test(f))) return "test";
  if (text.includes("refactor")) return "refactor";
  if (files.length <= 2 && text.includes("add")) return "feat";
  if (files.some((f) => /claude\.md$/i.test(f))) return "docs";
  return "chore";
}

function guessArea(files) {
  if (!files.length) return "";
  const top = files
    .map((f) => f.split("/")[0])
    .filter(Boolean)
    .reduce((acc, segment) => {
      acc[segment] = (acc[segment] || 0) + 1;
      return acc;
    }, {});
  return Object.entries(top).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

function summarizeTarget(files) {
  if (!files.length) return "repository changes";
  if (files.length === 1) return files[0];
  if (files.length <= 4) return `${files.length} related files`;
  return `${files.length} files across project`;
}

function extractChangeHints(diffText) {
  const hints = [];
  const lines = diffText.split("\n");
  const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;

  hints.push(`add ${added} line(s) and remove ${removed} line(s)`);

  if (/function\s+\w+|\w+\s*=>\s*\{/.test(diffText)) {
    hints.push("update function-level behavior and logic flow");
  }
  if (/class\s+\w+/.test(diffText)) {
    hints.push("adjust class structure and related implementation details");
  }
  if (/import |require\(/.test(diffText)) {
    hints.push("touch dependency/import usage to support these changes");
  }

  return hints;
}

function buildNarrativeSummary({
  stagedFiles,
  unstagedFiles,
  untrackedFiles,
  diffText,
  allFiles,
  fileComparisons
}) {
  const lines = diffText.split("\n");
  const added = lines.filter((l) => l.startsWith("+") && !l.startsWith("+++")).length;
  const removed = lines.filter((l) => l.startsWith("-") && !l.startsWith("---")).length;

  const fileScope = allFiles.length === 1 ? allFiles[0] : `${allFiles.length} files`;
  const touchedParts = [];
  if (stagedFiles.length) touchedParts.push(`${stagedFiles.length} staged`);
  if (unstagedFiles.length) touchedParts.push(`${unstagedFiles.length} unstaged`);
  if (untrackedFiles.length) touchedParts.push(`${untrackedFiles.length} new`);
  const touchSummary = touchedParts.length ? touchedParts.join(", ") : "tracked";

  const changeSentence = `This update modifies ${fileScope} (${touchSummary} changes), with ${added} lines added and ${removed} lines removed.`;
  const fileDetailSentence = summarizePerFileChanges(fileComparisons);
  return `${changeSentence} ${fileDetailSentence}`.trim();
}

function summarizePerFileChanges(fileComparisons) {
  if (!fileComparisons?.length) return "";

  const summaries = fileComparisons.slice(0, 3).map((item) => {
    const previous = item.previous || "";
    const current = item.current || "";

    if (previous.includes("did not exist in previous commit")) {
      return `${item.file} was added as a new file.`;
    }
    if (current.includes("file deleted in working tree")) {
      return `${item.file} was removed from the working tree.`;
    }
    return `${item.file} content was updated.`;
  });

  if (fileComparisons.length > 3) {
    summaries.push(`${fileComparisons.length - 3} additional file(s) were also updated.`);
  }
  return summaries.join(" ");
}

function unique(items) {
  return [...new Set(items)];
}

function trimLength(str, max) {
  if (str.length <= max) return str;
  return `${str.slice(0, max - 1)}…`;
}

async function generateCommitMessageViaProxy(changeContext, proxyBaseUrl, accessToken) {
  const headers = { "content-type": "application/json" };
  if (accessToken) {
    headers.authorization = `Bearer ${accessToken}`;
  }

  const res = await fetch(`${proxyBaseUrl}/api/commit-message`, {
    method: "POST",
    headers,
    body: JSON.stringify(changeContext)
  });

  if (!res.ok) {
    const text = await res.text();
    let detail = text;
    try {
      detail = JSON.parse(text).error || text;
    } catch (_error) {
      /* use raw text */
    }
    throw new Error(`Proxy error ${res.status}: ${detail}`);
  }

  const data = await res.json();
  const message = sanitizeCommitMessage(data.message);
  if (!message) {
    throw new Error("Proxy returned an empty message.");
  }
  return message;
}

async function generateCommitMessageWithAnthropic(changeContext, apiKey) {
  const config = vscode.workspace.getConfiguration("gitCommitMessageButton");
  const model = config.get("anthropicModel", "claude-3-5-sonnet-latest");
  const maxTokens = config.get("anthropicMaxTokens", 320);

  if (!apiKey) {
    throw new Error(
      "Missing Anthropic key: set gitCommitMessageButton.anthropicApiKey or server/.env ANTHROPIC_API_KEY."
    );
  }

  const prompt = buildCommitPrompt(changeContext);

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }]
    })
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${text}`);
  }

  const data = await res.json();
  const textBlocks = (data.content || [])
    .filter((item) => item.type === "text")
    .map((item) => item.text)
    .join("\n")
    .trim();
  if (!textBlocks) {
    throw new Error("Anthropic returned an empty response.");
  }
  return sanitizeCommitMessage(textBlocks);
}

async function buildFileComparisons(cwd, files) {
  const maxCharsPerSide = vscode.workspace
    .getConfiguration("gitCommitMessageButton")
    .get("maxFileContentChars", 5000);

  const comparisons = [];
  for (const file of files) {
    const currentPath = path.join(cwd, file);
    const currentExists = fs.existsSync(currentPath);
    const current = currentExists
      ? safeReadFile(currentPath, maxCharsPerSide)
      : "(file deleted in working tree)";

    const previousResult = await runGitAllowFailure(["show", `HEAD:${file}`], cwd, 1024 * 1024);
    const previous =
      previousResult.code === 0
        ? trimLength(previousResult.stdout, maxCharsPerSide)
        : "(file did not exist in previous commit or unavailable)";

    comparisons.push({
      file,
      previous,
      current
    });
  }
  return comparisons;
}

function safeReadFile(filePath, maxChars) {
  try {
    const content = fs.readFileSync(filePath, "utf8");
    return trimLength(content, maxChars);
  } catch (_error) {
    return "(unable to read current file content)";
  }
}

function runGitAllowFailure(args, cwd, maxBuffer = 1024 * 1024) {
  return new Promise((resolve) => {
    cp.execFile(
      "git",
      args,
      { cwd, maxBuffer, encoding: "utf8" },
      (error, stdout, stderr) => {
        if (error) {
          resolve({ stdout: "", stderr: stderr?.trim() || error.message, code: error.code || 1 });
          return;
        }
        resolve({ stdout, stderr, code: 0 });
      }
    );
  });
}

module.exports = {
  activate,
  deactivate
};
