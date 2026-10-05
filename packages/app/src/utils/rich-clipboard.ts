import { createAssistantMarkdownParser } from "./assistant-markdown-parser";

const markdownRenderer = createAssistantMarkdownParser();

type ClipboardMimeType = "text/plain" | "text/html";

export interface MarkdownClipboardContent {
  plainText: string;
  html: string;
}

export interface RichClipboardWriter {
  supportsHtml: () => boolean;
  write: (data: Record<ClipboardMimeType, Blob>) => Promise<void>;
}

export interface MarkdownClipboardEnvironment {
  richWriter?: RichClipboardWriter | null;
  writePlainText: (text: string) => Promise<unknown>;
}

export function createMarkdownClipboardContent(markdown: string): MarkdownClipboardContent {
  return {
    plainText: markdown,
    html: `<meta charset="utf-8">${markdownRenderer.render(markdown)}`,
  };
}

/**
 * Remove Markdown code fences and keep what they wrap.
 *
 * Copying is for the content, not the syntax that renders it: a copied fenced block
 * pasted into a shell, an editor, or another chat should arrive as the code itself.
 * The fence info string and the delimiters go; the code does not.
 *
 * A fence inside a fenced block is only reached by the lazy match when a shorter
 * fence closes it first, and `{3,}` lets an author's longer fence win over a
 * nested run of backticks.
 */
export function stripCodeFences(markdown: string): string {
  return markdown
    .replace(/^[ \t]*(`{3,})[^\n]*\n([\s\S]*?)\n[ \t]*\1[ \t]*$/gm, "$2")
    .replace(/^[ \t]*(`{3,})[^\n]*\n([\s\S]*?)[ \t]*$/gm, "$2")
    .replace(/\n{3,}/g, "\n\n");
}

export interface CodeClipboardOptions {
  language?: string | null;
  /** Wrap in `pre`/`code` so the line structure survives. */
  block: boolean;
}

/**
 * Clipboard payload for a selection that lies inside rendered code.
 *
 * `plainText` is the code exactly as it was selected, so it pastes straight into a
 * shell or an editor.
 *
 * The html half stays undecorated for a single line, matching the rule that a partial
 * selection does not carry its container's formatting. Multi-line code is the
 * exception and needs `pre`: HTML collapses newlines, so anything else loses the line
 * structure in a rich target exactly the way the plain half would.
 *
 * The fence info string is agent-authored, so the language is escaped as an attribute
 * value rather than interpolated raw.
 */
export function createCodeClipboardContent(
  code: string,
  options: CodeClipboardOptions,
): MarkdownClipboardContent {
  const escapedCode = markdownRenderer.utils.escapeHtml(code);
  if (!options.block) {
    return { plainText: code, html: `<meta charset="utf-8">${escapedCode}` };
  }

  const language = options.language?.trim();
  const className = language
    ? ` class="language-${markdownRenderer.utils.escapeHtml(language)}"`
    : "";
  return {
    plainText: code,
    html: `<meta charset="utf-8"><pre><code${className}>${escapedCode}</code></pre>`,
  };
}

export async function writeMarkdownToRichClipboard(
  markdown: string,
  environment: MarkdownClipboardEnvironment,
): Promise<void> {
  if (environment.richWriter?.supportsHtml()) {
    const content = createMarkdownClipboardContent(markdown);
    try {
      await environment.richWriter.write({
        "text/plain": new Blob([content.plainText], { type: "text/plain" }),
        "text/html": new Blob([content.html], { type: "text/html" }),
      });
      return;
    } catch {
      // Fall through to the plain-text path. Some webviews expose rich clipboard
      // APIs but deny writes depending on focus, permissions, or browser policy.
    }
  }

  await environment.writePlainText(markdown);
}
