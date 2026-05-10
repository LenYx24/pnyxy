import { useRef, useState } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { useTranslation } from "react-i18next";
import { LogIn, LogOut, Settings as SettingsIcon, User } from "lucide-react";
import { useAuthStore } from "@/stores/auth-store";
import { FloatingMenu } from "@/components/ui/FloatingMenu";
import { cn } from "@/lib/cn";

/**
 * Mobile-only top bar. Carries the brand on the left and an avatar
 * button on the right that opens a small menu with Profile, Settings
 * and Sign In / Out — these used to sit in the bottom nav, but the
 * bottom rail is reserved for the four high-traffic surfaces
 * (Library / Chat / Reader / Browse).
 *
 * Hidden on desktop (which has the full Sidebar) and on the reader
 * route (which uses its own toolbar and benefits from every vertical
 * pixel for the page surface).
 */
export function MobileTopBar() {
  const { t } = useTranslation();
  const { user, profile, signOut } = useAuthStore();
  const navigate = useNavigate();

  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const initial =
    (profile?.display_name?.[0] ?? user?.email?.[0] ?? "?").toUpperCase();

  const handleSignOut = async () => {
    setOpen(false);
    await signOut();
    navigate("/auth");
  };

  const close = () => setOpen(false);

  return (
    <header
      className="fixed left-0 right-0 top-0 z-40 flex h-12 items-center justify-between border-b border-glass-border bg-bg-secondary/90 px-3 backdrop-blur-xl pt-safe-top md:hidden"
      style={{ height: "calc(3rem + var(--spacing-safe-top, 0px))" }}
    >
      <Link to="/" aria-label="Pnyxy home" className="flex items-center">
        <img src="/logo.svg" alt="Pnyxy" className="h-7 w-auto" />
      </Link>

      {user ? (
        <>
          <button
            ref={triggerRef}
            onClick={() => setOpen((v) => !v)}
            aria-label={t("sidebar.profile", { defaultValue: "Profile" })}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-purple/15 text-sm font-bold text-accent-purple transition-colors hover:bg-accent-purple/25"
          >
            {profile?.avatar_url ? (
              <img
                src={profile.avatar_url}
                alt=""
                className="h-9 w-9 rounded-full object-cover"
              />
            ) : (
              <span>{initial}</span>
            )}
          </button>
          <FloatingMenu open={open} anchorRef={triggerRef} onClose={close}>
            <MobileTopBarMenuItem
              to="/profile"
              icon={User}
              label={t("sidebar.profile", { defaultValue: "Profile" })}
              onClick={close}
            />
            <MobileTopBarMenuItem
              to="/settings"
              icon={SettingsIcon}
              label={t("sidebar.settings", { defaultValue: "Settings" })}
              onClick={close}
            />
            <button
              type="button"
              onClick={handleSignOut}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary"
            >
              <LogOut size={16} />
              <span>{t("sidebar.signOut", { defaultValue: "Sign out" })}</span>
            </button>
          </FloatingMenu>
        </>
      ) : (
        <Link
          to="/auth"
          className="flex h-9 items-center gap-1.5 rounded-full border border-glass-border px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-glass-hover hover:text-text-primary"
        >
          <LogIn size={14} />
          <span>{t("sidebar.signIn", { defaultValue: "Sign in" })}</span>
        </Link>
      )}
    </header>
  );
}

function MobileTopBarMenuItem({
  to,
  icon: Icon,
  label,
  onClick,
}: {
  to: string;
  icon: typeof User;
  label: string;
  onClick: () => void;
}) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-2 px-3 py-2 text-sm transition-colors",
          isActive
            ? "bg-accent-purple/15 text-accent-purple"
            : "text-text-secondary hover:bg-glass-hover hover:text-text-primary",
        )
      }
    >
      <Icon size={16} />
      <span>{label}</span>
    </NavLink>
  );
}
