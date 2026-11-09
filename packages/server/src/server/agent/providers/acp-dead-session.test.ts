import { describe, expect, test, vi } from "vitest";

import { ACPAgentSession } from "./acp-agent.js";
import { asInternals } from "../../test-utils/class-mocks.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentStreamEvent } from "../agent-sdk-types.js";

interface Internals {
  sessionId: string | null;
  connection: { prompt: (...args: unknown[]) => Promise<unknown>; signal: AbortSignal } | null;
  activeForegroundTurnId: string | null;
}

function createSession(): ACPAgentSession {
  return new ACPAgentSession(
    { provider: "dead-acp", cwd: "/tmp/paseo-acp-test" },
    {
      provider: "dead-acp",
      logger: createTestLogger(),
      defaultCommand: ["true"],
      defaultModes: [],
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
      },
    },
  );
}

function terminalEvents(events: AgentStreamEvent[]): AgentStreamEvent[] {
  return events.filter(
    (event) =>
      event.type === "turn_completed" ||
      event.type === "turn_failed" ||
      event.type === "turn_canceled",
  );
}

describe("a turn on a disconnected ACP session", () => {
  test("startTurn refuses a connection that already aborted", async () => {
    const session = createSession();
    const controller = new AbortController();
    controller.abort();
    const internals = asInternals<Internals>(session);
    internals.sessionId = "session-1";
    internals.connection = {
      prompt: vi.fn(() => new Promise(() => undefined)),
      signal: controller.signal,
    };

    await expect(session.startTurn("second")).rejects.toThrow("ACP agent disconnected");
    expect(internals.activeForegroundTurnId).toBeNull();
  });

  test("a transport that closes before its response fails the turn instead of hanging", async () => {
    const session = createSession();
    const controller = new AbortController();
    const internals = asInternals<Internals>(session);
    internals.sessionId = "session-1";
    internals.connection = {
      prompt: vi.fn(() => new Promise(() => undefined)),
      signal: controller.signal,
    };
    const events: AgentStreamEvent[] = [];
    session.subscribe((event) => events.push(event));

    const { turnId } = await session.startTurn("first");
    controller.abort();

    await vi.waitFor(() => expect(terminalEvents(events)).toHaveLength(1), { timeout: 4_000 });
    expect(terminalEvents(events)).toEqual([
      expect.objectContaining({ type: "turn_failed", turnId, error: "ACP agent disconnected" }),
    ]);
    expect(internals.activeForegroundTurnId).toBeNull();
  }, 10_000);
});
