export function hasAuthoritySecondFactor(token: Record<string, unknown>) {
  const firebase = token.firebase as Record<string, unknown> | undefined;
  return firebase?.sign_in_second_factor === "phone" || firebase?.sign_in_second_factor === "totp";
}
