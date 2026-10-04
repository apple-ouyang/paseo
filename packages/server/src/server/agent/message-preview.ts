import type { AgentTimelineItem } from "./agent-sdk-types.js";

/**
 * The newest messages kept in the agent record so History can match what was
 * said, not only the title. The record is rewritten on every state event, so
 * both numbers stay small: five messages of at most 500 characters each.
 */
export const MESSAGE_PREVIEW_LIMIT = 5;
export const MESSAGE_PREVIEW_TEXT_LIMIT = 500;

/**
 * A long timeline with a burst of tool calls could sit between messages. The
 * walk stops there rather than scanning the whole history on every append.
 */
export const MESSAGE_PREVIEW_SCAN_LIMIT = 200;

export interface AgentMessagePreview {
  role: "user" | "assistant";
  text: string;
}

/** Collapse whitespace and cut on a character budget, marking the cut. */
export function capMessagePreviewText(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= MESSAGE_PREVIEW_TEXT_LIMIT) {
    return collapsed;
  }
  return `${collapsed.slice(0, MESSAGE_PREVIEW_TEXT_LIMIT - 1)}…`;
}

/**
 * The newest logical messages, oldest first. Providers stream assistant text as
 * a run of contiguous `assistant_message` items (Claude chunks a reply), so a
 * run merges into one message with no separator, matching how the daemon joins
 * the last reply elsewhere.
 */
export function buildMessagePreview(items: readonly AgentTimelineItem[]): AgentMessagePreview[] {
  const newestFirst: AgentMessagePreview[] = [];
  let previousWasAssistant = false;
  let scanned = 0;

  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (scanned >= MESSAGE_PREVIEW_SCAN_LIMIT) {
      break;
    }
    scanned += 1;

    const item = items[index];
    if (item.type === "assistant_message") {
      const previous = newestFirst[newestFirst.length - 1];
      if (previousWasAssistant && previous?.role === "assistant") {
        previous.text = capMessagePreviewText(`${item.text}${previous.text}`);
      } else {
        newestFirst.push({ role: "assistant", text: capMessagePreviewText(item.text) });
      }
      previousWasAssistant = true;
    } else if (item.type === "user_message") {
      newestFirst.push({ role: "user", text: capMessagePreviewText(item.text) });
      previousWasAssistant = false;
    } else {
      // A reasoning step or tool call ends the current reply's chunk run.
      previousWasAssistant = false;
      continue;
    }

    if (newestFirst.length >= MESSAGE_PREVIEW_LIMIT) {
      break;
    }
  }

  return newestFirst.toReversed();
}

/**
 * The excerpt a History row shows when the query only matched a message, newest
 * message first. Returns null when no message carries a token.
 */
export function messagePreviewSnippet(
  query: string,
  preview: readonly AgentMessagePreview[],
  limit = 160,
): AgentMessagePreview | null {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  if (tokens.length === 0) {
    return null;
  }

  for (const message of preview.toReversed()) {
    const haystack = message.text.toLowerCase();
    const token = tokens.find((candidate) => haystack.includes(candidate));
    if (token === undefined) {
      continue;
    }
    const start = haystack.indexOf(token);
    // Keep the match inside the window: normally 40 characters of lead-in, but
    // anchor the window to the match when the lead-in would push it out.
    const head = Math.max(0, start - 40);
    const from = Math.max(0, Math.min(head, start + token.length - limit));
    const to = Math.min(message.text.length, from + limit);
    const prefix = from > 0 ? "…" : "";
    const suffix = to < message.text.length ? "…" : "";
    return { role: message.role, text: `${prefix}${message.text.slice(from, to)}${suffix}` };
  }

  return null;
}
