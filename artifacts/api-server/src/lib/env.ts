import { getEnvironmentValue } from "@workspace/db/database-url";

export function getEnv(name: string): string | undefined {
  return getEnvironmentValue(process.env, name);
}
