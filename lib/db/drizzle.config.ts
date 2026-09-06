import { defineConfig } from "drizzle-kit";
import path from "path";
import { requireDatabaseUrl } from "./database-url.mjs";

const { url: databaseUrl } = requireDatabaseUrl(process.env);

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
