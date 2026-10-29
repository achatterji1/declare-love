import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const code = readFileSync(new URL("../public/declare/password-reset.js", import.meta.url), "utf8");
const sandbox = { URL, URLSearchParams };
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(code, sandbox);
const api = sandbox.DeclarePassword;

function testRedirectAvoidsLocalhost() {
  const page = "/declare/index.html";
  assert.equal(
    api.passwordResetRedirect({ origin: "http://localhost:8080", hostname: "localhost", pathname: page }),
    "https://playdeclare.com/declare/index.html"
  );
  assert.equal(
    api.passwordResetRedirect({ origin: "http://127.0.0.1:3000", hostname: "127.0.0.1", pathname: page }),
    "https://playdeclare.com/declare/index.html"
  );
  assert.equal(
    api.passwordResetRedirect({ origin: "http://[::1]:8080", hostname: "::1", pathname: page }),
    "https://playdeclare.com/declare/index.html"
  );
  assert.equal(api.passwordResetRedirect({ origin: "", pathname: page }), "https://playdeclare.com/declare/index.html");
  assert.equal(
    api.passwordResetRedirect({ origin: "https://playdeclare.com", hostname: "playdeclare.com", pathname: "/" }),
    "https://playdeclare.com/declare/index.html"
  );
  assert.equal(
    api.passwordResetRedirect({ origin: "https://playdeclare.com", hostname: "playdeclare.com", pathname: page }),
    "https://playdeclare.com/declare/index.html"
  );
  assert.equal(
    api.passwordResetRedirect({ origin: "https://preview.example", hostname: "preview.example", pathname: page }),
    "https://preview.example/declare/index.html"
  );
  const live = api.passwordResetRedirect({ origin: "http://localhost:5173", hostname: "localhost", pathname: page });
  assert.equal(live.includes("localhost"), false);
  assert.equal(live.startsWith("https://playdeclare.com/"), true);
}

function testPasswordRulesMatchSupabaseDefault() {
  assert.equal(api.PASSWORD_MIN_LENGTH, 6);
  assert.equal(api.PASSWORD_MAX_LENGTH, 72);
  assert.match(api.validateNewPassword("short", "short"), /at least 6/);
  assert.equal(api.validateNewPassword("longenough", "different"), "Those passwords do not match.");
  assert.equal(api.validateNewPassword("longenough", "longenough"), "");
  assert.match(api.validateNewPassword("x".repeat(73), "x".repeat(73)), /at most 72/);
  assert.match(api.validateNewPassword("1234567", "1234567", 8), /at least 8/);
  assert.equal(api.validateNewPassword("12345678", "12345678", 8), "");
}

function testNeutralResetCopy() {
  const sent = api.resetSentMessage();
  assert.match(sent, /If an account exists/);
  assert.match(sent, /we've sent a link/);
  assert.equal(/@/.test(sent), false);
  assert.equal(api.publicResetError("User not found"), "");
  assert.equal(api.publicResetError("Email not found"), "");
  assert.match(api.publicResetError("For security purposes, you can only request this once every 60 seconds"), /60 seconds/);
  assert.equal(api.publicResetError(""), "");
}

function testRecoveryGrantParsing() {
  const grant = api.recoveryParams("#access_token=abc&refresh_token=ref&expires_at=99&type=recovery", "");
  assert.equal(api.isRecoveryGrant(grant), true);
  assert.equal(grant.accessToken, "abc");
  assert.equal(grant.refreshToken, "ref");
  assert.equal(grant.type, "recovery");
  const expired = api.recoveryParams("#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&type=recovery", "");
  assert.equal(api.isRecoveryGrant(expired), false);
  assert.match(expired.error, /invalid or has expired/);
  assert.equal(api.isRecoveryGrant(api.recoveryParams("", "?type=recovery")), false);
  assert.equal(api.isRecoveryGrant(api.recoveryParams("#access_token=abc&type=signup", "")), false);
}

function testDialogModes() {
  const forgot = api.authView("forgot");
  assert.equal(forgot.title, "Reset password");
  assert.equal(forgot.submit, "Send reset link");
  assert.equal(forgot.showEmail, true);
  assert.equal(forgot.showPassword, false);
  assert.equal(forgot.showNew, false);
  assert.equal(forgot.showForgot, false);
  assert.match(forgot.lead, /If an account exists/);

  const recover = api.authView("recover");
  assert.equal(recover.title, "Set new password");
  assert.equal(recover.submit, "Update password");
  assert.equal(recover.showNew, true);
  assert.equal(recover.showConfirm, true);
  assert.equal(recover.showEmail, false);
  assert.equal(recover.showSwap, false);
  assert.match(recover.lead, /at least 6 characters/);

  const done = api.authView("done");
  assert.match(done.lead, /You're signed in/);
  assert.equal(done.submit, "Continue");

  const signIn = api.authView("in");
  assert.equal(signIn.showForgot, true);
  assert.equal(signIn.submit, "Sign in");
  assert.equal(signIn.showGoogle, true);
  const create = api.authView("up");
  assert.equal(create.showForgot, false);
  assert.equal(create.showGoogle, true);
  assert.equal(create.submit, "Create account");
}

function testPageWiresResetFlow() {
  const html = readFileSync(new URL("../public/declare/index.html", import.meta.url), "utf8");
  assert.match(html, /src="password-reset\.js"/);
  assert.match(html, /id="forgotPassword"/);
  assert.match(html, /Forgot password\?/);
  assert.match(html, /id="authNewPassword"/);
  assert.match(html, /id="authConfirm"/);
  assert.match(html, /minlength="6"/);
  assert.match(html, /maxlength="72"/);
  assert.match(html, /resetPasswordForEmail\(email,\s*\{\s*redirectTo:\s*api\.passwordResetRedirect\(location\)\s*\}\)/);
  assert.match(html, /updateUser\(\{\s*password:\s*next\s*\}\)/);
  assert.match(html, /PASSWORD_RECOVERY/);
  assert.match(html, /flowType:\s*"implicit"/);
  assert.match(html, /id="trialBtn"/);
  assert.match(html, /Trial Game stay open without an account/);
  assert.equal(html.includes("jznrjnxugegwntmafrsb"), false);
  assert.equal(html.includes("localhost"), false);
  const script = html.slice(html.indexOf("function submitForgot"), html.indexOf("function submitNewPassword"));
  assert.match(script, /resetSentMessage/);
  assert.match(script, /publicResetError/);
}

testRedirectAvoidsLocalhost();
testPasswordRulesMatchSupabaseDefault();
testNeutralResetCopy();
testRecoveryGrantParsing();
testDialogModes();
testPageWiresResetFlow();
console.log("password reset tests ok");
