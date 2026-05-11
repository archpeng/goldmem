import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "./postgres-schema.js";

export type Db = NodePgDatabase<typeof schema>;

export type PostgresStoreOptions = {
  databaseUrl: string;
  audioDir?: string;
  publicAudioBaseUrl?: string;
};
