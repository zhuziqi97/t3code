/** Find the first code-unit offset after context envelopes injected into a Codex message. */
function skipLeadingCodexContext(text: string): number {
  const contextTags = [
    "recommended_plugins",
    "environment_context",
    "user_instructions",
    "codex_internal_context",
    "external_codex_apps_open_page",
    "in-app-browser-context",
    "system-reminder",
  ];
  let offset = 0;
  const skipWhitespace = () => {
    while (offset < text.length && /\s/.test(text[offset] ?? "")) offset += 1;
  };

  skipWhitespace();
  while (offset < text.length) {
    let removedContext = false;
    for (const tag of contextTags) {
      const openingTag = text.slice(offset).match(new RegExp(`^<${tag}(?:\\s[^>]*|)>`))?.[0];
      if (openingTag === undefined) continue;
      const closingTag = `</${tag}>`;
      const closingOffset = text.indexOf(closingTag, offset + openingTag.length);
      if (closingOffset === -1) return text.length;
      offset = closingOffset + closingTag.length;
      skipWhitespace();
      removedContext = true;
      break;
    }
    if (removedContext) continue;

    const agentsHeading = "# AGENTS.md instructions";
    const agentsHeadingEnd = offset + agentsHeading.length;
    if (
      text.startsWith(agentsHeading, offset) &&
      (agentsHeadingEnd === text.length || /\s/.test(text[agentsHeadingEnd] ?? ""))
    ) {
      const headingEnd = text.indexOf("\n", offset);
      if (headingEnd === -1) return text.length;
      offset = headingEnd + 1;
      skipWhitespace();
      const openingTag = "<INSTRUCTIONS>";
      if (text.startsWith(openingTag, offset)) {
        const closingTag = "</INSTRUCTIONS>";
        const closingOffset = text.indexOf(closingTag, offset + openingTag.length);
        if (closingOffset === -1) return text.length;
        offset = closingOffset + closingTag.length;
        skipWhitespace();
      }
      continue;
    }
    break;
  }
  return offset;
}

/** Derive a visible title without mistaking Codex-injected context for the user request. */
export function deriveImportedThreadTitle(
  text: string,
  source: "codex" | "claudeAgent",
): string | null {
  const visibleText =
    source === "codex" ? text.slice(skipLeadingCodexContext(text)) : text.trimStart();
  const lineEnd = visibleText.indexOf("\n");
  const firstLine = visibleText
    .slice(0, lineEnd === -1 ? visibleText.length : lineEnd)
    .slice(0, 100)
    .trim();
  return firstLine && firstLine.length > 0 ? firstLine : null;
}

/** Recognize only first-line placeholders produced by the old Codex importer. */
export function isLegacyCodexContextTitle(title: string): boolean {
  return (
    /^# AGENTS\.md instructions(?:\s|$)/.test(title) ||
    /^<(?:recommended_plugins|environment_context|user_instructions|system-reminder|in-app-browser-context|codex_internal_context|external_codex_apps_open_page)(?:\s[^>]*|)>$/.test(
      title,
    )
  );
}

/** Repair only importer placeholders, never an ordinary imported or user-supplied name. */
export function isImportedThreadPlaceholderTitle(title: string): boolean {
  return title === "Imported thread" || isLegacyCodexContextTitle(title);
}
