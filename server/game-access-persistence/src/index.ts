export { createGameAccessDatabase, type GameAccessDatabaseSettings } from "./database.ts";
export {
  GAME_ACCESS_MIGRATION_LOCK_TABLE,
  GAME_ACCESS_MIGRATION_TABLE,
  gameAccessMigrator,
  migrateGameAccessToLatest,
} from "./migrations.ts";
export { PostgresGameAccessStore } from "./repository.ts";
export type {
  GameAccessDatabase,
  GameAssignmentsTable,
  GameSeatControlTable,
  ReferencedUserSessionsTable,
} from "./schema.ts";
