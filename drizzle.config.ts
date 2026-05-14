import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./infra/db/schema.ts",
  out: "./infra/db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgres://mem:mem@localhost:5432/mem",
  },
});
