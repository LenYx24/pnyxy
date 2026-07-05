import { Outlet } from "react-router";

/**
 * Wraps every public, pre-auth page (landing, auth, forgot/reset
 * password, welcome). Forces the static dark marketing palette via
 * data-static-theme so these pages never inherit the user's runtime
 * app theme (applied to <html>), which would otherwise put light/sepia
 * text on their forced-dark mesh. The landing overrides this on its own
 * root for its light/dark toggle. New public pages get correct theming
 * for free just by living under this layout.
 */
export function PublicLayout() {
  return (
    <div data-static-theme="dark">
      <Outlet />
    </div>
  );
}
