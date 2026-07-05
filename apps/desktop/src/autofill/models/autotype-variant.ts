/**
 * The kind of autotype sequence to send when triggered from a vault item.
 *
 * - `UsernamePassword` types the username, a tab, then the password.
 * - `Password` types only the password.
 */
export const AutotypeVariant = Object.freeze({
  UsernamePassword: "usernamePassword",
  Password: "password",
} as const);

export type AutotypeVariant = (typeof AutotypeVariant)[keyof typeof AutotypeVariant];
