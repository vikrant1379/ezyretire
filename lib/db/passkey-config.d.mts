export interface PasskeyConfigurationInput {
  rpID?: string;
  origin?: string;
  requireHttps?: boolean;
}

export interface PasskeyConfigurationResult {
  problems: string[];
  rpID: string;
  origin?: string;
}

export function validatePasskeyConfiguration(
  input: PasskeyConfigurationInput,
): PasskeyConfigurationResult;