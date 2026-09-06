const supportedDatabaseVariables = new Set([
  "DATABASE_URL",
  "NEON_DATABASE_URL",
]);

/** Vercel Neon integration prefix. Change this when the project slug changes. */
export const envVariablePrefix = "retiro_";

export function getEnvironmentValue(environment, name) {
  return environment[name] ?? environment[`${envVariablePrefix}${name}`];
}

export function selectDatabaseVariableName(environment) {
  const configuredName =
    environment.DATABASE_URL_VARIABLE ??
    (environment.VERCEL ? "DATABASE_URL" : "NEON_DATABASE_URL");
  const baseName = configuredName.startsWith(envVariablePrefix)
    ? configuredName.slice(envVariablePrefix.length)
    : configuredName;

  if (!supportedDatabaseVariables.has(baseName)) {
    throw new Error(
      `DATABASE_URL_VARIABLE must be DATABASE_URL or NEON_DATABASE_URL (or their ${envVariablePrefix} prefixed name)`,
    );
  }

  if (environment[configuredName]) return configuredName;
  if (environment[baseName]) return baseName;
  if (environment[`${envVariablePrefix}${baseName}`]) {
    return `${envVariablePrefix}${baseName}`;
  }

  return baseName;
}

export function requireDatabaseUrl(environment) {
  const variableName = selectDatabaseVariableName(environment);
  const url = environment[variableName];

  if (!url) {
    throw new Error(
      `${variableName} must be set (selected by DATABASE_URL_VARIABLE or the runtime default).`,
    );
  }

  return { variableName, url };
}