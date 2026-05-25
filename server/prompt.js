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

function buildCommitPrompt({
  stagedFiles,
  unstagedFiles,
  untrackedFiles,
  diffText,
  includeBody,
  fileComparisons
}) {
  return [
    "Write a high quality git commit message from this change context.",
    "Use conventional commits style in subject: type(scope): short summary.",
    "Subject max 72 chars.",
    "Ensure the subject and body describe the same scope of changes.",
    "If multiple files or areas changed, use a broad subject that covers all changes.",
    "Do not use a single-file/backend-only subject when frontend or other areas also changed.",
    "Only use a narrow subject when exactly one logical change area is present.",
    includeBody
      ? "Then include 2-3 full sentences summarizing only what changed inside files."
      : "Return subject only.",
    "Compare previous and current file snapshots explicitly.",
    "The Diff section is unified git diff vs the last commit: lines starting with + were added, lines starting with - were removed.",
    "Never describe an addition as a removal (or vice versa). If Diff and snapshots disagree, trust the Diff.",
    "Do not infer product impact, intent, or outcomes. Only state concrete file/content changes.",
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
    "Per-file previous vs new snapshots:",
    formatFileComparisonsForPrompt(fileComparisons),
    "",
    "Diff:",
    String(diffText).slice(0, 120000)
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
  formatFileComparisonsForPrompt
};
