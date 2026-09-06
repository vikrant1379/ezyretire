export const envVariablePrefix: "retiro_";

export type DatabaseVariableName =
  | "DATABASE_URL"
  | "NEON_DATABASE_URL"
  | `${typeof envVariablePrefix}DATABASE_URL`
  | `${typeof envVariablePrefix}NEON_DATABASE_URL`;

export function getEnvironmentValue(
  environment: NodeJS.ProcessEnv,
  name: string,
): string | undefined;

export function selectDatabaseVariableName(
  environment: NodeJS.ProcessEnv,
): DatabaseVariableName;

export function requireDatabaseUrl(environment: NodeJS.ProcessEnv): {
  variableName: DatabaseVariableName;
  url: string;
};
