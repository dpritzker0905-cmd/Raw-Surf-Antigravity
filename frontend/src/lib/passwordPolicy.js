export const MIN_PASSWORD_LENGTH = 12;
export const PASSWORD_MINIMUM_MESSAGE = `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;

export function meetsPasswordMinimum(password) {
  // Count Unicode code points to match the API's Python string length.
  return Array.from(password).length >= MIN_PASSWORD_LENGTH;
}
