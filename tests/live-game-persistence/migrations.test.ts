import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  COMMAND_BINDING_RECORD_FORMAT,
  LIVE_GAME_STATE_FORMAT,
  LIVE_GAME_STATE_FORMAT_V1,
} from "@chess-one/live-game";
import { SqlFileMigrationProvider } from "@chess-one/live-game-persistence";
import { describe, expect, it } from "vitest";

const MIGRATIONS = fileURLToPath(
  new URL("../../server/live-game-persistence/migrations", import.meta.url),
);

const NAMES = [
  "001_live_games",
  "002_live_game_command_bindings",
  "003_outbox_events",
  "004_live_game_lifecycle",
];
/** The migrations that create a table each; later ones only alter. */
const TABLE_MIGRATIONS = NAMES.slice(0, 3);

async function sqlOf(file: string): Promise<string> {
  return readFile(join(MIGRATIONS, file), "utf8");
}

async function allUp(): Promise<string> {
  const texts = await Promise.all(NAMES.map((name) => sqlOf(`${name}.up.sql`)));
  return texts.join("\n");
}

/** SQL without `--` comments, so checks see statements only. */
function statements(text: string): string {
  return text.replace(/--.*$/gm, "");
}

describe("TST-PERSIST migrations (static; applying them needs PostgreSQL, see test:db)", () => {
  it("TST-PERSIST-070 the provider offers exactly the numbered migrations, each with up and down", async () => {
    const migrations = await new SqlFileMigrationProvider(MIGRATIONS).getMigrations();
    expect(Object.keys(migrations)).toEqual(NAMES);
    for (const name of NAMES) {
      expect(typeof migrations[name]?.up, name).toBe("function");
      expect(typeof migrations[name]?.down, name).toBe("function");
    }
    const files = (await readdir(MIGRATIONS)).sort();
    expect(files).toEqual(NAMES.flatMap((name) => [`${name}.down.sql`, `${name}.up.sql`]));
  });

  it("TST-PERSIST-071 migrations create only the three tables, in dependency order, and each down drops its own", async () => {
    const created = [...statements(await allUp()).matchAll(/CREATE TABLE (\w+)/g)].map(
      (match) => match[1],
    );
    expect(created).toEqual(["live_games", "live_game_command_bindings", "outbox_events"]);
    for (const [index, name] of TABLE_MIGRATIONS.entries()) {
      const down = statements(await sqlOf(`${name}.down.sql`)).trim();
      expect(down, name).toBe(`DROP TABLE ${created[index]};`);
    }
    for (const name of NAMES) {
      const up = statements(await sqlOf(`${name}.up.sql`));
      expect(up, name).not.toMatch(
        /\b(DROP(?! CONSTRAINT)|(?<!ON )DELETE|TRUNCATE|EXTENSION|GRANT|ALTER ROLE)\b/i,
      );
    }
  });

  it("TST-PERSIST-075 the lifecycle migration only widens live_games for v2 and its down restores the v1 checks", async () => {
    const up = statements(await sqlOf("004_live_game_lifecycle.up.sql")).replace(/\s+/g, " ");
    expect(up).not.toMatch(/CREATE TABLE|live_game_command_bindings|outbox_events/);
    expect(up).toContain("CHECK (state_format IN ('live_game_state.v1', 'live_game_state.v2'))");
    expect(up).toContain(
      "state_format = 'live_game_state.v2' AND status_kind IN ('awaiting_players', 'aborted_before_start')",
    );
    expect(up).toContain("CONSTRAINT live_games_pre_game_shape");
    expect(up).toContain("WHERE status_kind = 'awaiting_players'");
    const down = statements(await sqlOf("004_live_game_lifecycle.down.sql")).replace(/\s+/g, " ");
    expect(down).toContain("CHECK (state_format = 'live_game_state.v1')");
    expect(down).toContain("CHECK (status_kind IN ('active', 'finished', 'unresolved'))");
    expect(down).toContain("DROP CONSTRAINT live_games_pre_game_shape");
    expect(down).toContain("DROP INDEX live_games_awaiting_deadline_idx");
    for (const name of TABLE_MIGRATIONS) {
      expect(await sqlOf(`${name}.up.sql`), `${name} is history`).not.toContain("v2");
    }
  });

  it("TST-PERSIST-072 keys, uniqueness, and the pending-outbox index are declared", async () => {
    const up = statements(await allUp()).replace(/\s+/g, " ");
    for (const constraint of [
      "CONSTRAINT live_games_pkey PRIMARY KEY (game_id)",
      "CONSTRAINT live_game_command_bindings_pkey PRIMARY KEY (game_id, seat, client_command_id)",
      "CONSTRAINT live_game_command_bindings_ordinal_key UNIQUE (game_id, binding_ordinal)",
      "FOREIGN KEY (game_id) REFERENCES live_games (game_id) ON DELETE RESTRICT",
      "CONSTRAINT outbox_events_pkey PRIMARY KEY (event_id)",
      "UNIQUE (aggregate_type, aggregate_id, aggregate_sequence, event_type)",
      "FOREIGN KEY (aggregate_id) REFERENCES live_games (game_id) ON DELETE RESTRICT",
      "event_id uuid NOT NULL DEFAULT gen_random_uuid()",
      "publication_status text NOT NULL DEFAULT 'pending'",
      "CREATE INDEX outbox_events_pending_idx ON outbox_events (created_at, event_id) WHERE publication_status = 'pending'",
      "CHECK (sequence >= 0)",
    ]) {
      expect(up, constraint).toContain(constraint);
    }
  });

  it("TST-PERSIST-073 the schema pins the serialization version the codec writes", async () => {
    const up = await allUp();
    expect(up).toContain(`'${LIVE_GAME_STATE_FORMAT_V1}', '${LIVE_GAME_STATE_FORMAT}'`);
    expect(up).toContain(`record_format = '${COMMAND_BINDING_RECORD_FORMAT}'`);
    expect(statements(up)).not.toMatch(/\bjson\b(?!b)/i);
  });

  it("TST-PERSIST-074 a misnamed migration or a missing down file is refused", async () => {
    const directory = await mkdtemp(join(tmpdir(), "chess-one-migrations-"));
    try {
      await writeFile(join(directory, "1_bad.up.sql"), "SELECT 1;");
      await expect(new SqlFileMigrationProvider(directory).getMigrations()).rejects.toThrow(
        /Unexpected migration file name/,
      );
      await rm(join(directory, "1_bad.up.sql"));
      await writeFile(join(directory, "004_orphan.up.sql"), "SELECT 1;");
      await expect(new SqlFileMigrationProvider(directory).getMigrations()).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
