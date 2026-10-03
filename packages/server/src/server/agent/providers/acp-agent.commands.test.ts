import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, test } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { ACPAgentClient } from "./acp-agent.js";
import { CopilotACPAgentClient } from "./copilot-acp-agent.js";

describe("ACP clients slash commands", () => {
  test("the base ACP client waits for commands by default", async () => {
    await withFakeACPAgent(async (scriptPath, cwd) => {
      const client = new ACPAgentClient({
        provider: "generic-acp",
        logger: createTestLogger(),
        defaultCommand: [process.execPath, scriptPath],
      });
      const session = await client.createSession({ provider: "generic-acp", cwd });
      try {
        await expect(session.listCommands?.()).resolves.toEqual([
          { name: "review", description: "Review the diff", argumentHint: "", kind: "command" },
        ]);
      } finally {
        await session.close();
      }
    });
  });

  test("the Copilot ACP client waits for commands by default", async () => {
    await withFakeACPAgent(async (scriptPath, cwd) => {
      const client = new CopilotACPAgentClient({
        logger: createTestLogger(),
        runtimeSettings: {
          command: { mode: "replace", argv: [process.execPath, scriptPath] },
        },
      });
      const session = await client.createSession({ provider: "copilot", cwd });
      try {
        await expect(session.listCommands?.()).resolves.toEqual([
          { name: "review", description: "Review the diff", argumentHint: "", kind: "command" },
        ]);
      } finally {
        await session.close();
      }
    });
  });
});

async function withFakeACPAgent(
  run: (scriptPath: string, cwd: string) => Promise<void>,
): Promise<void> {
  const testDir = await mkdtemp(path.join(tmpdir(), "paseo-acp-client-commands-"));
  try {
    const scriptPath = path.join(testDir, "fake-acp-agent.cjs");
    await writeFile(scriptPath, fakeACPAgentScript, "utf8");
    await run(scriptPath, testDir);
  } finally {
    await rm(testDir, { recursive: true, force: true });
  }
}

const fakeACPAgentScript = `
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });

function write(message) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\\n");
}

rl.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    write({
      id: message.id,
      result: {
        protocolVersion: message.params?.protocolVersion ?? 1,
        agentCapabilities: { sessionCapabilities: { close: {} } },
      },
    });
    return;
  }

  if (message.method === "session/new") {
    process.stdout.write(
      [
        { id: message.id, result: { sessionId: "session-1" } },
        {
          method: "session/update",
          params: {
            sessionId: "session-1",
            update: {
              sessionUpdate: "available_commands_update",
              availableCommands: [{ name: "review", description: "Review the diff" }],
            },
          },
        },
      ]
        .map((entry) => JSON.stringify({ jsonrpc: "2.0", ...entry }) + "\\n")
        .join(""),
    );
    return;
  }

  if (message.id !== undefined) {
    write({ id: message.id, result: {} });
  }
});
`;
