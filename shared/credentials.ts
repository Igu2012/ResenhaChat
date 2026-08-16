export const USERNAME_MIN_LENGTH = 4;
export const USERNAME_MAX_LENGTH = 20;
export const USERNAME_HTML_PATTERN = "[A-Za-z0-9](?:[A-Za-z0-9._]{2,18}[A-Za-z0-9])";
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 64;
export const PASSWORD_HTML_PATTERN = "[A-Za-z0-9!@#$%&*_.-]{8,64}";

export function isValidUsername(value: unknown) {
  return typeof value === "string" && new RegExp(`^${USERNAME_HTML_PATTERN}$`).test(value);
}

export function isValidPassword(value: unknown) {
  return typeof value === "string"
    && new RegExp(`^${PASSWORD_HTML_PATTERN}$`).test(value)
    && /[A-Za-z]/.test(value)
    && /\d/.test(value);
}

export function passwordsMatch(password: unknown, confirmation: unknown) {
  return typeof password === "string" && password.length > 0 && password === confirmation;
}

export const usernameRuleMessage = "Use 4 a 20 caracteres: letras, números, ponto ou sublinhado; sem espaços.";
export const passwordRuleMessage = "Use 8 a 64 caracteres: letras, números e apenas ! @ # $ % & * _ . ou -.";
