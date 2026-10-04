import { describe, expect, it } from "vitest";
import type { AgentTimelineItem } from "./agent-sdk-types.js";
import {
  buildMessagePreview,
  capMessagePreviewText,
  MESSAGE_PREVIEW_LIMIT,
  MESSAGE_PREVIEW_TEXT_LIMIT,
  messagePreviewSnippet,
} from "./message-preview.js";

function user(text: string): AgentTimelineItem {
  return { type: "user_message", text };
}

function assistant(text: string): AgentTimelineItem {
  return { type: "assistant_message", text };
}

const reasoning: AgentTimelineItem = { type: "reasoning", text: "thinking about it" };

describe("capMessagePreviewText", () => {
  it("collapses whitespace and trims", () => {
    expect(capMessagePreviewText("  hello\n\tworld  ")).toBe("hello world");
  });

  it("cuts long text on the budget and marks the cut", () => {
    const capped = capMessagePreviewText("x".repeat(MESSAGE_PREVIEW_TEXT_LIMIT + 50));
    expect(capped).toHaveLength(MESSAGE_PREVIEW_TEXT_LIMIT);
    expect(capped.endsWith("…")).toBe(true);
  });

  it("keeps text that fits exactly", () => {
    const exact = "y".repeat(MESSAGE_PREVIEW_TEXT_LIMIT);
    expect(capMessagePreviewText(exact)).toBe(exact);
  });
});

describe("buildMessagePreview", () => {
  it("returns nothing for a timeline without messages", () => {
    expect(buildMessagePreview([reasoning])).toEqual([]);
  });

  it("keeps the newest messages, oldest first", () => {
    const preview = buildMessagePreview([user("one"), assistant("two"), user("three")]);
    expect(preview).toEqual([
      { role: "user", text: "one" },
      { role: "assistant", text: "two" },
      { role: "user", text: "three" },
    ]);
  });

  it("keeps only the newest messages", () => {
    const items: AgentTimelineItem[] = [];
    for (let index = 0; index < MESSAGE_PREVIEW_LIMIT + 3; index += 1) {
      items.push(user(`question ${index}`), assistant(`answer ${index}`));
    }
    const preview = buildMessagePreview(items);
    expect(preview).toHaveLength(MESSAGE_PREVIEW_LIMIT);
    expect(preview.at(-1)).toEqual({ role: "assistant", text: "answer 7" });
    expect(preview.at(0)).toEqual({ role: "assistant", text: "answer 5" });
    expect(preview.some((message) => message.text === "question 4")).toBe(false);
    expect(preview.some((message) => message.text === "question 5")).toBe(false);
  });

  it("joins contiguous assistant chunks into one reply", () => {
    const preview = buildMessagePreview([user("explain"), assistant("the "), assistant("answer")]);
    expect(preview).toEqual([
      { role: "user", text: "explain" },
      { role: "assistant", text: "the answer" },
    ]);
  });

  it("treats a reasoning step between replies as a message boundary", () => {
    const preview = buildMessagePreview([
      assistant("first reply"),
      reasoning,
      assistant("second reply"),
    ]);
    expect(preview).toEqual([
      { role: "assistant", text: "first reply" },
      { role: "assistant", text: "second reply" },
    ]);
  });

  it("ignores non-message items between messages", () => {
    const preview = buildMessagePreview([
      user("hi"),
      reasoning,
      { type: "todo", items: [] },
      assistant("done"),
    ]);
    expect(preview).toEqual([
      { role: "user", text: "hi" },
      { role: "assistant", text: "done" },
    ]);
  });

  it("caps each message", () => {
    const preview = buildMessagePreview([user("z".repeat(MESSAGE_PREVIEW_TEXT_LIMIT + 10))]);
    expect(preview[0]?.text).toHaveLength(MESSAGE_PREVIEW_TEXT_LIMIT);
  });

  it("stops walking a long tail of non-message items", () => {
    const items: AgentTimelineItem[] = [
      user("ancient question"),
      ...Array.from({ length: 400 }, () => reasoning),
    ];
    expect(buildMessagePreview(items)).toEqual([]);
  });
});

describe("messagePreviewSnippet", () => {
  const preview = [
    { role: "user" as const, text: "please rename the legacy importer" },
    { role: "assistant" as const, text: "I renamed the importer and updated its callers" },
  ];

  it("returns null when no message carries a token", () => {
    expect(messagePreviewSnippet("kubernetes", preview)).toBeNull();
  });

  it("matches the newest message first and is case insensitive", () => {
    expect(messagePreviewSnippet("IMPORTER", preview)).toEqual({
      role: "assistant",
      text: "I renamed the importer and updated its callers",
    });
  });

  it("keeps the match inside the window and marks both cuts", () => {
    const long = `${"a".repeat(200)} needle ${"b".repeat(200)}`;
    const snippet = messagePreviewSnippet("needle", [{ role: "user", text: long }], 100);
    expect(snippet?.text).toContain("needle");
    expect(snippet?.text.length).toBeLessThanOrEqual(102);
    expect(snippet?.text.startsWith("…")).toBe(true);
    expect(snippet?.text.endsWith("…")).toBe(true);
  });

  it("returns null for an empty query", () => {
    expect(messagePreviewSnippet("   ", preview)).toBeNull();
  });
});
