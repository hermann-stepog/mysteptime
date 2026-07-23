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
export const DRAKE_BROWSER_SESSION_NOT_AUTHENTICATED =
  "DRAKE_BROWSER_SESSION_NOT_AUTHENTICATED";
export const DRAKE_SESSION_TRANSFER_FAILED = "DRAKE_SESSION_TRANSFER_FAILED";

export function browserSessionNotAuthenticatedError(): DrakeAuthError {
  return new DrakeAuthError(
    DRAKE_BROWSER_SESSION_NOT_AUTHENTICATED,
    "O login no Drake não produziu uma sessão autenticada.",
  );
}

export function sessionTransferFailedError(): DrakeAuthError {
  return new DrakeAuthError(
    DRAKE_SESSION_TRANSFER_FAILED,
    "A sessão do Drake foi criada, mas não pôde ser transferida para o cliente de integração.",
  );
}

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
