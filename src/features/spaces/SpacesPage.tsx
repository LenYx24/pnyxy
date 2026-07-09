import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router";
import { Boxes, BadgeCheck, Loader2, Plus, LogIn } from "lucide-react";
import { Button } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";
import { useSpaceStore } from "@/stores/space-store";
import type { Space, SpaceKind, SpaceVisibility } from "@/types/space";
import { cn } from "@/lib/cn";

const KINDS: SpaceKind[] = ["org", "course", "topic"];
const VISIBILITIES: SpaceVisibility[] = ["public", "private"];

export function SpacesPage() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const {
    mySpaces,
    publicSpaces,
    memberIds,
    loading,
    error,
    fetchAll,
    createSpace,
    joinSpace,
  } = useSpaceStore();

  const [name, setName] = useState("");
  const [kind, setKind] = useState<SpaceKind>("org");
  const [visibility, setVisibility] = useState<SpaceVisibility>("public");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [joiningId, setJoiningId] = useState<string | null>(null);

  useEffect(() => {
    if (user) void fetchAll();
  }, [user, fetchAll]);

  if (!user) {
    return (
      <div className="mx-auto max-w-2xl space-y-6 p-4 sm:p-6">
        <Header />
        <section className="rounded-xl border border-glass-border bg-glass-bg/50 p-6 text-center">
          <p className="mb-4 text-text-secondary">
            {t("spaces.signInPrompt", {
              defaultValue: "Sign in to browse and create spaces.",
            })}
          </p>
          <Link to="/auth">
            <Button>
              <LogIn size={16} />
              {t("auth.signIn")}
            </Button>
          </Link>
        </section>
      </div>
    );
  }

  const handleCreate = async () => {
    if (!name.trim() || creating) return;
    setFormError(null);
    setCreating(true);
    try {
      await createSpace({ name, kind, visibility });
      setName("");
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Failed to create space.");
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = async (id: string) => {
    setJoiningId(id);
    try {
      await joinSpace(id);
    } catch {
      // surfaced via store error
    } finally {
      setJoiningId(null);
    }
  };

  const discover = publicSpaces.filter((s) => !memberIds.has(s.id));

  return (
    <div className="mx-auto max-w-4xl space-y-8 p-4 sm:p-6">
      <Header />

      {/* Create */}
      <section className="space-y-3 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
        <h2 className="text-sm font-semibold text-text-primary">
          {t("spaces.createHeading", { defaultValue: "Create a space" })}
        </h2>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            placeholder={t("spaces.namePlaceholder", {
              defaultValue: "Name (e.g. BME, BSz1, Health)",
            })}
            className="min-w-0 flex-1 rounded-lg border border-glass-border bg-bg-tertiary px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
          />
          <Select value={kind} onChange={(v) => setKind(v as SpaceKind)} options={KINDS} labelPrefix="kind" />
          <Select
            value={visibility}
            onChange={(v) => setVisibility(v as SpaceVisibility)}
            options={VISIBILITIES}
            labelPrefix="visibility"
          />
          <Button onClick={handleCreate} disabled={creating || !name.trim()}>
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
            {t("spaces.create", { defaultValue: "Create" })}
          </Button>
        </div>
        {formError && <p className="text-xs text-danger">{formError}</p>}
        {error && <p className="text-xs text-danger">{error}</p>}
      </section>

      {loading ? (
        <div className="flex items-center justify-center py-16 text-text-muted">
          <Loader2 className="h-6 w-6 animate-spin" />
        </div>
      ) : (
        <>
          {/* My spaces */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-text-primary">
              {t("spaces.mine", { defaultValue: "Your spaces" })}
            </h2>
            {mySpaces.length === 0 ? (
              <p className="text-sm text-text-muted">
                {t("spaces.mineEmpty", { defaultValue: "You haven't joined any spaces yet." })}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {mySpaces.map((s) => (
                  <SpaceCard key={s.id} space={s} />
                ))}
              </div>
            )}
          </section>

          {/* Discover */}
          <section className="space-y-3">
            <h2 className="text-sm font-semibold text-text-primary">
              {t("spaces.discover", { defaultValue: "Discover" })}
            </h2>
            {discover.length === 0 ? (
              <p className="text-sm text-text-muted">
                {t("spaces.discoverEmpty", { defaultValue: "No public spaces to show." })}
              </p>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {discover.map((s) => (
                  <SpaceCard
                    key={s.id}
                    space={s}
                    action={
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => handleJoin(s.id)}
                        disabled={joiningId === s.id}
                      >
                        {joiningId === s.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          t("spaces.join", { defaultValue: "Join" })
                        )}
                      </Button>
                    }
                  />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function Header() {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-accent/10">
        <Boxes size={20} className="text-accent" />
      </div>
      <div>
        <h1 className="text-2xl font-bold text-text-primary">
          {t("spaces.title", { defaultValue: "Spaces" })}
        </h1>
        <p className="text-xs text-text-muted">
          {t("spaces.subtitle", {
            defaultValue: "Communities & courses — organizations, courses, and topics.",
          })}
        </p>
      </div>
    </div>
  );
}

function SpaceCard({ space, action }: { space: Space; action?: React.ReactNode }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => navigate(`/spaces/${space.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          navigate(`/spaces/${space.id}`);
        }
      }}
      className="flex cursor-pointer flex-col rounded-xl border border-glass-border bg-bg-secondary p-4 text-left transition-colors hover:border-accent/40"
    >
      <div className="mb-1 flex items-center gap-1.5">
        <span className="truncate font-semibold text-text-primary">{space.name}</span>
        {space.official && (
          <BadgeCheck size={15} className="shrink-0 text-accent" aria-label="Official" />
        )}
      </div>
      <span className="mb-2 font-mono text-2xs uppercase tracking-wide text-text-muted">
        {t(`spaces.kind.${space.kind}`, { defaultValue: space.kind })}
        {space.visibility !== "public" &&
          ` · ${t(`spaces.visibility.${space.visibility}`, { defaultValue: space.visibility })}`}
      </span>
      {space.description && (
        <p className="mb-3 line-clamp-2 text-xs text-text-secondary">{space.description}</p>
      )}
      {action && (
        <div className="mt-auto pt-1" onClick={(e) => e.stopPropagation()}>
          {action}
        </div>
      )}
    </div>
  );
}

function Select({
  value,
  onChange,
  options,
  labelPrefix,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  labelPrefix: string;
}) {
  const { t } = useTranslation();
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cn(
        "cursor-pointer rounded-lg border border-glass-border bg-bg-tertiary px-2.5 py-2 text-sm text-text-primary outline-none focus:border-accent",
      )}
    >
      {options.map((o) => (
        <option key={o} value={o}>
          {t(`spaces.${labelPrefix}.${o}`, { defaultValue: o })}
        </option>
      ))}
    </select>
  );
}
