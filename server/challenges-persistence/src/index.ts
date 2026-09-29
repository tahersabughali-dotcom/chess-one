export { type ChallengesDatabaseSettings, createChallengesDatabase } from "./database.ts";
export {
  CHALLENGES_MIGRATION_LOCK_TABLE,
  CHALLENGES_MIGRATION_TABLE,
  challengesMigrator,
  migrateChallengesToLatest,
} from "./migrations.ts";
export { PostgresChallengeStore } from "./repository.ts";
export type { ChallengesDatabase, ChallengesTable, ReferencedUsersTable } from "./schema.ts";
