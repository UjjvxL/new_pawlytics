import assert from "node:assert/strict";
import test from "node:test";
import { hasAuthoritySecondFactor } from "./authority-policy";

test("authority access requires a Firebase-verified second factor, not an admin or enrollment claim", () => {
  assert.equal(hasAuthoritySecondFactor({ platformAdmin: true }), false);
  assert.equal(hasAuthoritySecondFactor({ mfaEnrolled: true }), false);
  assert.equal(hasAuthoritySecondFactor({ firebase: { sign_in_provider: "google.com" } }), false);
  assert.equal(hasAuthoritySecondFactor({ firebase: { sign_in_second_factor: "phone" } }), true);
  assert.equal(hasAuthoritySecondFactor({ firebase: { sign_in_second_factor: "totp" } }), true);
});
