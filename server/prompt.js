function formatFileComparisonsForPrompt(fileComparisons) {
  if (!fileComparisons?.length) return "(none)";
  return fileComparisons
    .map(
      (item) => [
        `FILE: ${item.file}`,
        "PREVIOUS:",
        item.previous || "(empty)",
        "CURRENT:",
        item.current || "(empty)",
        "---"
      ].join("\n")
    )
    .join("\n");
}

function summarizeDiffForPrompt(diffText) {
  const lines = String(diffText).split("\n");
  const added = [];
  const removed = [];
  for (const line of lines) {
    if (line.startsWith("+") && !line.startsWith("+++")) {
      added.push(line.slice(1).trim());
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed.push(line.slice(1).trim());
    }
  }
  const parts = [
    `Diff summary (authoritative): ${added.length} line(s) added, ${removed.length} line(s) removed.`
  ];
  if (added.length) {
    parts.push(`Added examples: ${added.slice(0, 10).join(" | ")}`);
  }
  if (removed.length) {
    parts.push(`Removed examples: ${removed.slice(0, 10).join(" | ")}`);
  }
  if (added.length && !removed.length) {
    parts.push("Primary change type: ADDITIONS only — subject/body must describe what was added, not removed.");
  } else if (removed.length && !added.length) {
    parts.push("Primary change type: DELETIONS only — subject/body must describe what was removed, not added.");
  }
  return parts.join("\n");
}

function buildCommitPrompt({
  stagedFiles,
  unstagedFiles,
  untrackedFiles,
  diffText,
  includeBody,
  fileComparisons
}) {
  const diff = String(diffText).slice(0, 120000);
  const outputRules = includeBody
    ? [
        "OUTPUT FORMAT (required):",
        "Line 1: subject only (conventional commit), max 72 characters.",
        "Line 2: empty.",
        "Line 3+: body only (2-3 sentences).",
        "The subject and body MUST agree: same action (add/remove/update) and same scope.",
        "Do not say something was removed in the subject and added in the body (or the reverse).",
        "Do not open the body by restating or contradicting the subject."
      ]
    : ["OUTPUT FORMAT: return the subject line only (max 72 characters), nothing else."];

  return [
    "Write a git commit message from the change context below.",
    "",
    ...outputRules,
    "",
    "Rules:",
    "- The Diff and Diff summary are authoritative (+ added, - removed).",
    "- Use the Diff summary counts before writing; do not invert add vs remove.",
    "- File snapshots are supplementary; if they disagree with Diff, trust Diff.",
    "- Use conventional commits: type(scope): short summary.",
    "- If multiple areas changed, use a broad subject covering all of them.",
    "- State only concrete code changes visible in Diff; no intent or impact.",
    "",
    summarizeDiffForPrompt(diff),
    "",
    `Staged files (${stagedFiles.length}):`,
    stagedFiles.join("\n") || "(none)",
    "",
    `Unstaged files (${unstagedFiles.length}):`,
    unstagedFiles.join("\n") || "(none)",
    "",
    `Untracked files (${untrackedFiles.length}):`,
    untrackedFiles.join("\n") || "(none)",
    "",
    "Per-file snapshots (supplementary):",
    formatFileComparisonsForPrompt(fileComparisons),
    "",
    "Diff:",
    diff
  ].join("\n");
}

function sanitizeCommitMessage(raw) {
  let text = String(raw || "").trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```[a-zA-Z0-9_-]*\s*\n?/, "");
    text = text.replace(/\n?```$/, "");
  }
  return text.trim();
}

module.exports = {
  buildCommitPrompt,
  sanitizeCommitMessage,
  formatFileComparisonsForPrompt,
  summarizeDiffForPrompt
};
