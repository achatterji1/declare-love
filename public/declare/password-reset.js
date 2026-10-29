(function (root) {
  // Supabase Auth's default minimum (GOTRUE_PASSWORD_MIN_LENGTH). Signup uses the same length.
  var PASSWORD_MIN_LENGTH = 6;
  var PASSWORD_MAX_LENGTH = 72;
  var LIVE_ORIGIN = "https://playdeclare.com";

  function isLocalHost(hostname) {
    var host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
    return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1";
  }

  function passwordResetRedirect(loc) {
    var origin = loc && loc.origin ? String(loc.origin) : "";
    var path = loc && loc.pathname ? String(loc.pathname) : "";
    var hostname = loc && loc.hostname ? String(loc.hostname) : "";
    if (!hostname && origin) {
      try { hostname = new URL(origin).hostname; } catch (e) { hostname = ""; }
    }
    if (!path || path === "/") path = "/declare/index.html";
    var base = !origin || isLocalHost(hostname) ? LIVE_ORIGIN : origin.replace(/\/$/, "");
    return base + path;
  }

  function validateNewPassword(password, confirm, minLength) {
    var min = minLength || PASSWORD_MIN_LENGTH;
    var next = password || "";
    if (next.length < min) return "Password must be at least " + min + " characters.";
    if (next.length > PASSWORD_MAX_LENGTH) return "Password must be at most " + PASSWORD_MAX_LENGTH + " characters.";
    if (next !== (confirm || "")) return "Those passwords do not match.";
    return "";
  }

  function resetSentMessage() {
    return "If an account exists, we've sent a link to reset the password.";
  }

  function publicResetError(message) {
    var msg = String(message || "").trim();
    if (!msg) return "";
    if (/user not found|no user found|email not found|user does not exist/i.test(msg)) return "";
    return msg;
  }

  function recoveryParams(hash, search) {
    var fromHash = new URLSearchParams(String(hash || "").replace(/^#/, ""));
    var fromQuery = new URLSearchParams(String(search || "").replace(/^\?/, ""));
    function pick(name) {
      return fromHash.get(name) || fromQuery.get(name) || "";
    }
    var description = pick("error_description");
    return {
      type: pick("type"),
      accessToken: pick("access_token"),
      refreshToken: pick("refresh_token"),
      expiresAt: pick("expires_at"),
      error: description ? description.replace(/\+/g, " ") : (pick("error") || "")
    };
  }

  function isRecoveryGrant(params) {
    return !!(params && params.type === "recovery" && params.accessToken);
  }

  function authView(mode, minLength) {
    var min = minLength || PASSWORD_MIN_LENGTH;
    if (mode === "forgot") {
      return {
        title: "Reset password",
        submit: "Send reset link",
        swap: "Back to sign in",
        lead: "Enter the email on your account. If an account exists, we'll send a link.",
        showEmail: true,
        showPassword: false,
        showNew: false,
        showConfirm: false,
        showForgot: false,
        showSwap: true,
        showGoogle: false
      };
    }
    if (mode === "recover") {
      return {
        title: "Set new password",
        submit: "Update password",
        swap: "",
        lead: "Choose a new password. It must be at least " + min + " characters.",
        showEmail: false,
        showPassword: false,
        showNew: true,
        showConfirm: true,
        showForgot: false,
        showSwap: false,
        showGoogle: false
      };
    }
    if (mode === "done") {
      return {
        title: "Password updated",
        submit: "Continue",
        swap: "",
        lead: "Your password is updated. You're signed in.",
        showEmail: false,
        showPassword: false,
        showNew: false,
        showConfirm: false,
        showForgot: false,
        showSwap: false,
        showGoogle: false
      };
    }
    if (mode === "up") {
      return {
        title: "Sign in",
        submit: "Create account",
        swap: "Already have an account",
        lead: "",
        showEmail: true,
        showPassword: true,
        showNew: false,
        showConfirm: false,
        showForgot: false,
        showSwap: true,
        showGoogle: true
      };
    }
    return {
      title: "Sign in",
      submit: "Sign in",
      swap: "Create an account",
      lead: "",
      showEmail: true,
      showPassword: true,
      showNew: false,
      showConfirm: false,
      showForgot: true,
      showSwap: true,
      showGoogle: true
    };
  }

  root.DeclarePassword = {
    LIVE_ORIGIN: LIVE_ORIGIN,
    PASSWORD_MIN_LENGTH: PASSWORD_MIN_LENGTH,
    PASSWORD_MAX_LENGTH: PASSWORD_MAX_LENGTH,
    isLocalHost: isLocalHost,
    passwordResetRedirect: passwordResetRedirect,
    validateNewPassword: validateNewPassword,
    resetSentMessage: resetSentMessage,
    publicResetError: publicResetError,
    recoveryParams: recoveryParams,
    isRecoveryGrant: isRecoveryGrant,
    authView: authView
  };
})(typeof globalThis !== "undefined" ? globalThis : this);
