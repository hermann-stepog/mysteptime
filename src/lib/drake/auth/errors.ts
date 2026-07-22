export class DrakeAuthError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "DrakeAuthError";
    this.code = code;
  }
}

export const DRAKE_CREDENTIALS_NOT_CONFIGURED = "DRAKE_CREDENTIALS_NOT_CONFIGURED";
export const DRAKE_INTERACTIVE_AUTH_REQUIRED = "DRAKE_INTERACTIVE_AUTH_REQUIRED";
export const DRAKE_SESSION_EXPIRED = "DRAKE_SESSION_EXPIRED";
export const DRAKE_AUTH_FAILED = "DRAKE_AUTH_FAILED";

export function credentialsNotConfiguredError(): DrakeAuthError {
  return new DrakeAuthError(
    DRAKE_CREDENTIALS_NOT_CONFIGURED,
    "As credenciais de integração do Drake não estão configuradas.",
  );
}

export function interactiveAuthRequiredError(): DrakeAuthError {
  return new DrakeAuthError(
    DRAKE_INTERACTIVE_AUTH_REQUIRED,
    "O login do Drake exige uma confirmação interativa e a atualização não pôde ser executada automaticamente.",
  );
}
