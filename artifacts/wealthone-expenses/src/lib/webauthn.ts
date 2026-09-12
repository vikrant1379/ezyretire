type JsonCredentialDescriptor = Omit<PublicKeyCredentialDescriptor, "id"> & {
  id: string;
};

type JsonCreationOptions = Omit<PublicKeyCredentialCreationOptions, "challenge" | "user" | "excludeCredentials"> & {
  challenge: string;
  user: Omit<PublicKeyCredentialUserEntity, "id"> & { id: string };
  excludeCredentials?: JsonCredentialDescriptor[];
};

type JsonRequestOptions = Omit<PublicKeyCredentialRequestOptions, "challenge" | "allowCredentials"> & {
  challenge: string;
  allowCredentials?: JsonCredentialDescriptor[];
};

export type RegistrationCredentialJSON = {
  id: string;
  rawId: string;
  type: PublicKeyCredentialType;
  authenticatorAttachment: string | null;
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
  response: {
    clientDataJSON: string;
    attestationObject: string;
    transports?: string[];
  };
};

export type AuthenticationCredentialJSON = {
  id: string;
  rawId: string;
  type: PublicKeyCredentialType;
  authenticatorAttachment: string | null;
  clientExtensionResults: AuthenticationExtensionsClientOutputs;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
    userHandle: string | null;
  };
};

function decodeBase64Url(value: string): ArrayBuffer {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const bytes = Uint8Array.from(window.atob(base64), (character) => character.charCodeAt(0));
  return bytes.buffer;
}

function encodeBase64Url(value: ArrayBuffer): string {
  const bytes = new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function credentialDescriptor(descriptor: JsonCredentialDescriptor): PublicKeyCredentialDescriptor {
  return { ...descriptor, id: decodeBase64Url(descriptor.id) };
}

export function isWebAuthnAvailable(): boolean {
  return typeof window !== "undefined"
    && window.isSecureContext
    && typeof PublicKeyCredential !== "undefined"
    && typeof navigator.credentials?.create === "function"
    && typeof navigator.credentials?.get === "function";
}

export function parseCreationOptions(value: JsonCreationOptions): PublicKeyCredentialCreationOptions {
  return {
    ...value,
    challenge: decodeBase64Url(value.challenge),
    user: { ...value.user, id: decodeBase64Url(value.user.id) },
    excludeCredentials: value.excludeCredentials?.map(credentialDescriptor),
  };
}

export function parseRequestOptions(value: JsonRequestOptions): PublicKeyCredentialRequestOptions {
  return {
    ...value,
    challenge: decodeBase64Url(value.challenge),
    allowCredentials: value.allowCredentials?.map(credentialDescriptor),
  };
}

export function registrationCredentialToJSON(credential: PublicKeyCredential): RegistrationCredentialJSON {
  const response = credential.response as AuthenticatorAttestationResponse;
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type as PublicKeyCredentialType,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      attestationObject: encodeBase64Url(response.attestationObject),
      transports: typeof response.getTransports === "function" ? response.getTransports() : undefined,
    },
  };
}

export function authenticationCredentialToJSON(credential: PublicKeyCredential): AuthenticationCredentialJSON {
  const response = credential.response as AuthenticatorAssertionResponse;
  return {
    id: credential.id,
    rawId: encodeBase64Url(credential.rawId),
    type: credential.type as PublicKeyCredentialType,
    authenticatorAttachment: credential.authenticatorAttachment,
    clientExtensionResults: credential.getClientExtensionResults(),
    response: {
      clientDataJSON: encodeBase64Url(response.clientDataJSON),
      authenticatorData: encodeBase64Url(response.authenticatorData),
      signature: encodeBase64Url(response.signature),
      userHandle: response.userHandle ? encodeBase64Url(response.userHandle) : null,
    },
  };
}

export function getWebAuthnErrorMessage(error: unknown, action: "sign in" | "add"): string {
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return action === "sign in"
      ? "Passkey sign-in was cancelled or timed out. You can try again or use an email code."
      : "Passkey setup was cancelled or timed out. No passkey was added.";
  }
  if (error instanceof DOMException && (error.name === "SecurityError" || error.name === "NotSupportedError")) {
    return "Passkeys are unavailable in this browser. Use a secure, supported browser or continue with email.";
  }
  return action === "sign in"
    ? "We couldn't sign you in with a passkey. Try again or use an email code."
    : "We couldn't add this passkey. Please try again.";
}