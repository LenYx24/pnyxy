// Password-reset hand-off. Supabase recovery emails redirect to
// whatever Site URL + allowed-redirect config the project has,
// not always /auth/reset-password. If the user lands anywhere
// else with a recovery link, the auto-session-from-URL would
// sign them in to a normal session and they'd skip the
// change-password form entirely. Catch it here, BEFORE the
// module bundle runs (and before the Supabase client consumes
// the tokens), and redirect to /auth/reset-password with the
// original hash/query preserved so the SDK still creates the
// recovery session on the correct page. Plain JS, no imports,
// so this runs before anything else.
//
// Two token shapes to catch, both marked `type=recovery`:
//   - implicit flow (legacy): tokens in the URL hash, e.g.
//     `#access_token=...&type=recovery`. Kept for emails sent
//     before the app switched to PKCE that may still be in
//     flight.
//   - PKCE flow (current): a single-use `code` in the query
//     string, e.g. `?code=...&type=recovery`. The `code` value
//     itself is passed through untouched, exchanged for a
//     session by the SDK on /auth/reset-password.
//
// Lives as its own static file (not inline in index.html) so the
// app's Content-Security-Policy can keep script-src to 'self'
// without an 'unsafe-inline' carve-out.
(function () {
  try {
    var hash = window.location.hash || "";
    var search = window.location.search || "";
    var isRecovery =
      hash.indexOf("type=recovery") !== -1 ||
      search.indexOf("type=recovery") !== -1;
    if (
      isRecovery &&
      window.location.pathname !== "/auth/reset-password"
    ) {
      window.location.replace(
        "/auth/reset-password" + search + hash,
      );
    }
  } catch (_e) {
    // best-effort; if anything throws we fall through to the
    // normal auth flow and the user lands wherever the email
    // sent them.
  }
})();
