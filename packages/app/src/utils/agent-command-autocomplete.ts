import {
  compareMatchScores,
  type MatchScore,
  scoreTextFields,
} from "@getpaseo/protocol/search/text-match";

interface CommandAutocompleteEntry {
  command: {
    name: string;
    aliases?: readonly string[];
    kind?: string;
  };
}

interface InlineSkillCommandEntry extends CommandAutocompleteEntry {
  source: "provider" | "client";
}

export type SlashCommandPosition = "start" | "inline";

export interface SlashCommandRange {
  start: number;
  end: number;
  query: string;
  position: SlashCommandPosition;
}

interface FindActiveSlashCommandInput {
  text: string;
  cursorIndex: number;
}

interface ApplySlashCommandReplacementInput {
  text: string;
  command: SlashCommandRange;
  commandName: string;
}

interface ScoredCommandAutocompleteEntry<TEntry> {
  entry: TEntry;
  score: MatchScore;
}

function scoreCommandAutocompleteEntry(
  entry: CommandAutocompleteEntry,
  query: string,
): MatchScore | null {
  return scoreTextFields(query, [entry.command.name, ...(entry.command.aliases ?? [])]);
}

// Slash command MRU. Behaviour is ported from grok-build's `slash/mru.rs`
// (xai-org/grok-build, crates/codegen/xai-grok-pager/src/slash/mru.rs): one
// timestamp per canonical command with no use count, scored through a 7-day
// half-life and a 0.1 floor. A stale favourite therefore loses to a fresh one,
// yet still sorts above a command that was never used.
const SLASH_COMMAND_MRU_STORAGE_KEY = "paseo.slash-command-mru.v1";
const SLASH_COMMAND_MRU_LIMIT = 256;
const RECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;
const RECENCY_FLOOR = 0.1;

type SlashCommandMruTable = Record<string, number>;

let cachedSlashCommandMru: SlashCommandMruTable | null = null;

function slashCommandMruStorage(): Storage | null {
  try {
    return globalThis.window?.localStorage ?? null;
  } catch {
    return null;
  }
}

/** History is a hint, never a dependency: a storage failure degrades to "nothing used yet". */
function readSlashCommandMru(): SlashCommandMruTable {
  if (cachedSlashCommandMru) {
    return cachedSlashCommandMru;
  }
  const storage = slashCommandMruStorage();
  if (storage) {
    try {
      const raw = storage.getItem(SLASH_COMMAND_MRU_STORAGE_KEY);
      const parsed: unknown = raw ? JSON.parse(raw) : null;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        cachedSlashCommandMru = parsed as SlashCommandMruTable;
        return cachedSlashCommandMru;
      }
    } catch {
      // Corrupt or unavailable storage: start over with an empty table.
    }
  }
  cachedSlashCommandMru = {};
  return cachedSlashCommandMru;
}

function persistSlashCommandMru(table: SlashCommandMruTable): void {
  const storage = slashCommandMruStorage();
  if (!storage) return;
  try {
    storage.setItem(SLASH_COMMAND_MRU_STORAGE_KEY, JSON.stringify(table));
  } catch {
    // Quota or disabled storage: keep the in-memory copy for this session.
  }
}

function pruneSlashCommandMru(table: SlashCommandMruTable): void {
  const names = Object.keys(table);
  if (names.length <= SLASH_COMMAND_MRU_LIMIT) return;
  names.sort((a, b) => table[a] - table[b]);
  for (const name of names.slice(0, names.length - SLASH_COMMAND_MRU_LIMIT)) {
    delete table[name];
  }
}

function normalizeSlashCommandName(name: string): string | null {
  const key = name.trim().replace(/^\/+/, "");
  return key ? key : null;
}

function recencyScore(lastUsedAt: number, now: number): number {
  if (!lastUsedAt) return 0;
  const age = Math.max(0, now - lastUsedAt);
  const factor = Math.max(0.5 ** (age / RECENCY_HALF_LIFE_MS), RECENCY_FLOOR);
  return (lastUsedAt / 1000) * factor;
}

function recencyScoreFor(
  entry: CommandAutocompleteEntry,
  table: SlashCommandMruTable,
  now: number,
): number {
  let best = 0;
  for (const name of [entry.command.name, ...(entry.command.aliases ?? [])]) {
    const key = normalizeSlashCommandName(name);
    if (!key) continue;
    best = Math.max(best, recencyScore(table[key] ?? 0, now));
  }
  return best;
}

/** Record that the user picked this command; the menu then leads with it next time. */
export function recordSlashCommandUse(name: string): void {
  const key = normalizeSlashCommandName(name);
  if (!key) return;
  const table = readSlashCommandMru();
  table[key] = Date.now();
  pruneSlashCommandMru(table);
  persistSlashCommandMru(table);
}

/** Most-recently-used ordering; commands without history keep the order their provider sent. */
export function rankCommandEntriesByRecency<TEntry extends CommandAutocompleteEntry>(
  entries: readonly TEntry[],
): TEntry[] {
  const table = readSlashCommandMru();
  const now = Date.now();
  const indexed = entries.map((entry, index) => ({
    entry,
    index,
    score: recencyScoreFor(entry, table, now),
  }));
  indexed.sort((a, b) => b.score - a.score || a.index - b.index);
  return indexed.map((scored) => scored.entry);
}

export function filterAndRankCommandAutocompleteEntries<TEntry extends CommandAutocompleteEntry>(
  entries: readonly TEntry[],
  query: string,
): TEntry[] {
  const normalizedQuery = query.trim().toLowerCase();
  if (normalizedQuery.length === 0) {
    return rankCommandEntriesByRecency(entries);
  }

  const scoredEntries: ScoredCommandAutocompleteEntry<TEntry>[] = [];
  for (const entry of entries) {
    const score = scoreCommandAutocompleteEntry(entry, normalizedQuery);
    if (score) {
      scoredEntries.push({ entry, score });
    }
  }

  const table = readSlashCommandMru();
  const now = Date.now();
  scoredEntries.sort((a, b) => {
    const scoreComparison = compareMatchScores(a.score, b.score);
    if (scoreComparison !== 0) {
      return scoreComparison;
    }
    const recencyComparison =
      recencyScoreFor(b.entry, table, now) - recencyScoreFor(a.entry, table, now);
    if (recencyComparison !== 0) {
      return recencyComparison;
    }
    return a.entry.command.name.localeCompare(b.entry.command.name);
  });

  return scoredEntries.map((scored) => scored.entry);
}

/** Tests only: drop the in-memory copy so the next read comes from storage. */
export function resetSlashCommandMruCacheForTests(): void {
  cachedSlashCommandMru = null;
}

export function filterInlineSkillCommandEntries<TEntry extends InlineSkillCommandEntry>(
  entries: readonly TEntry[],
): TEntry[] {
  return entries.filter((entry) => entry.source === "provider" && entry.command.kind === "skill");
}

const INVALID_SLASH_COMMAND_QUERY_CHARS = /[/\s\n\r\t"']/;

export function findActiveSlashCommand(
  input: FindActiveSlashCommandInput,
): SlashCommandRange | null {
  const clampedCursor = Math.max(0, Math.min(input.cursorIndex, input.text.length));
  const beforeCursor = input.text.slice(0, clampedCursor);

  for (
    let slashIndex = beforeCursor.lastIndexOf("/");
    slashIndex >= 0;
    slashIndex = slashIndex === 0 ? -1 : beforeCursor.lastIndexOf("/", slashIndex - 1)
  ) {
    const previousCharacter = slashIndex > 0 ? input.text[slashIndex - 1] : "";
    if (previousCharacter && !/\s/.test(previousCharacter)) {
      continue;
    }

    const query = beforeCursor.slice(slashIndex + 1);
    if (INVALID_SLASH_COMMAND_QUERY_CHARS.test(query)) {
      continue;
    }

    return {
      start: slashIndex,
      end: clampedCursor,
      query,
      position: slashIndex === 0 ? "start" : "inline",
    };
  }

  return null;
}

export function applySlashCommandReplacement(input: ApplySlashCommandReplacementInput): string {
  const before = input.text.slice(0, input.command.start);
  const after = input.text.slice(input.command.end);
  const replacement = `${before}/${input.commandName}${after}`;
  return input.command.end === input.text.length ? `${replacement} ` : replacement;
}
