import { fileURLToPath } from "node:url";
import {
  type ChallengesDatabase,
  createChallengesDatabase,
  migrateChallengesToLatest,
} from "@chess-one/challenges-persistence";
import type { Kysely } from "kysely";
import { type AccountsSchema, withAccountsSchema } from "../../accounts/support/db.ts";
import { testDatabaseUrl } from "../../live-game-persistence/support/disposable-schema.ts";

export const CHALLENGES_MIGRATIONS = fileURLToPath(
  new URL("../../../server/challenges-persistence/migrations", import.meta.url),
);

function sqlstate(error: unknown): unknown {
  return typeof error === "object" && error !== null && "code" in error ? error.code : null;
}

/**
 * The accounts disposable schema (local *_test database, generated schema
 * name, dropped afterwards; BLOCKED, never skipped, without a database) with
 * the challenge table migrated after the accounts tables it references,
 * unless `migrateChallenges` is false.
 */
export class ChallengesSchema {
  readonly base: AccountsSchema;
  readonly #url: string;
  readonly #applicationName: string;
  readonly #pools: Kysely<ChallengesDatabase>[] = [];

  constructor(base: AccountsSchema, url: string, applicationName: string) {
    this.base = base;
    this.#url = url;
    this.#applicationName = applicationName;
  }

  get name(): string {
    return this.base.name;
  }

  /** A new challenge pool on the schema, as another process would open. */
  challenges(maxConnections = 8): Kysely<ChallengesDatabase> {
    const db = createChallengesDatabase({
      connectionString: this.#url,
      maxConnections,
      applicationName: this.#applicationName,
      schema: this.base.name,
    });
    this.#pools.push(db);
    return db;
  }

  async destroyPools(): Promise<void> {
    await Promise.all(this.#pools.splice(0).map((db) => db.destroy()));
  }
}

export async function withChallengesSchema(
  applicationName: string,
  options: { readonly migrateChallenges?: boolean },
  run: (schema: ChallengesSchema) => Promise<void>,
): Promise<void> {
  await withAccountsSchema(applicationName, {}, async (base) => {
    const schema = new ChallengesSchema(base, testDatabaseUrl(), applicationName);
    try {
      if (options.migrateChallenges !== false) {
        const migrated = await migrateChallengesToLatest(
          schema.challenges(1),
          CHALLENGES_MIGRATIONS,
          schema.name,
        );
        if (migrated.error !== undefined) {
          throw new Error(
            `challenge migrations failed: sqlstate ${String(sqlstate(migrated.error))}`,
          );
        }
      }
      await run(schema);
    } finally {
      await schema.destroyPools();
    }
  });
}
