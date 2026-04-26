import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Building2, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui";
import { cn } from "@/lib/cn";
import { useAuthStore } from "@/stores/auth-store";
import { useOrgStore } from "@/stores/org-store";
import {
  PLAN_COLOR_KEYS,
  planColorClasses,
  type PlanColorKey,
} from "@/lib/plan-colors";
import type { Organization } from "@/types/organization";

export function OrganizationsTab() {
  const { t } = useTranslation();
  const user = useAuthStore((s) => s.user);
  const organizations = useOrgStore((s) => s.organizations);
  const isLoading = useOrgStore((s) => s.isLoading);
  const fetchMine = useOrgStore((s) => s.fetchMine);
  const createOrg = useOrgStore((s) => s.createOrg);
  const renameOrg = useOrgStore((s) => s.renameOrg);
  const recolorOrg = useOrgStore((s) => s.recolorOrg);
  const deleteOrg = useOrgStore((s) => s.deleteOrg);

  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState<PlanColorKey | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Organization | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (user && organizations.length === 0) void fetchMine();
  }, [user, organizations.length, fetchMine]);

  if (!user) {
    return (
      <section className="rounded-xl border border-glass-border bg-glass-bg/50 p-6 text-center">
        <p className="text-sm text-text-muted">
          {t("settings.organizations.signInFirst")}
        </p>
      </section>
    );
  }

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await createOrg(newName, newColor);
      setNewName("");
      setNewColor(null);
      setCreating(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteOrg(confirmDelete.id);
      setConfirmDelete(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6">
      <div className="flex items-center gap-2">
        <Building2 size={18} className="text-text-secondary" />
        <h2 className="text-lg font-semibold text-text-primary">
          {t("settings.organizations.heading")}
        </h2>
      </div>
      <p className="text-xs text-text-muted">
        {t("settings.organizations.description")}
      </p>
      <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-300/90">
        {t("settings.organizations.scopingNotice")}
      </p>

      {error && (
        <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      )}

      {/* Existing orgs */}
      <div className="space-y-2">
        {isLoading && organizations.length === 0 ? (
          <p className="text-xs text-text-muted">{t("common.loading")}</p>
        ) : (
          organizations.map((org) => (
            <OrgRow
              key={org.id}
              org={org}
              onRename={(name) => renameOrg(org.id, name).catch(showErr)}
              onRecolor={(color) =>
                recolorOrg(org.id, color).catch(showErr)
              }
              onDelete={() => setConfirmDelete(org)}
            />
          ))
        )}
      </div>

      {/* Create form */}
      {creating ? (
        <div className="space-y-3 rounded-lg border border-glass-border bg-bg-primary/40 p-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">
              {t("settings.organizations.nameLabel")}
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("settings.organizations.namePlaceholder")}
              maxLength={60}
              autoFocus
              className="w-full rounded-lg border border-glass-border bg-bg-primary/50 px-3 py-2 text-sm text-text-primary placeholder:text-text-muted outline-none focus:border-accent-purple"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">
              {t("settings.organizations.colorLabel")}
            </label>
            <ColorPicker value={newColor} onChange={setNewColor} />
          </div>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setCreating(false);
                setNewName("");
                setNewColor(null);
              }}
              disabled={submitting}
            >
              {t("common.cancel")}
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || submitting}
            >
              {t("settings.organizations.create")}
            </Button>
          </div>
        </div>
      ) : (
        <Button
          variant="secondary"
          onClick={() => setCreating(true)}
          className="gap-1 text-xs"
        >
          <Plus size={14} />
          {t("settings.organizations.newOrg")}
        </Button>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setConfirmDelete(null)}
          />
          <div className="relative z-10 w-full max-w-sm rounded-xl border border-glass-border bg-bg-secondary/95 p-6 backdrop-blur-xl">
            <h3 className="mb-2 text-lg font-semibold text-text-primary">
              {t("settings.organizations.confirmDeleteTitle", {
                name: confirmDelete.name,
              })}
            </h3>
            <p className="mb-4 text-sm text-text-muted">
              {t("settings.organizations.confirmDeleteBody")}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
              >
                {t("common.cancel")}
              </Button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="cursor-pointer rounded-lg bg-red-500/20 px-4 py-2 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/30 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {deleting
                  ? t("common.deleting")
                  : t("settings.organizations.deleteOrg")}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );

  function showErr(err: unknown) {
    setError(err instanceof Error ? err.message : String(err));
  }
}

function OrgRow({
  org,
  onRename,
  onRecolor,
  onDelete,
}: {
  org: Organization;
  onRename: (name: string) => void;
  onRecolor: (color: string | null) => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(org.name);
  const cc = planColorClasses(org.color);

  const commitRename = () => {
    const next = name.trim();
    if (!next || next === org.name) {
      setName(org.name);
      return;
    }
    onRename(next);
  };

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-glass-border bg-bg-primary/40 p-3 sm:flex-row sm:items-center">
      <span
        className={cn(
          "inline-block h-3 w-3 shrink-0 rounded-full",
          cc.swatch,
        )}
        aria-hidden="true"
      />
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitRename}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          else if (e.key === "Escape") {
            setName(org.name);
            (e.target as HTMLInputElement).blur();
          }
        }}
        maxLength={60}
        className="min-w-0 flex-1 rounded border border-transparent bg-transparent px-2 py-1 text-sm text-text-primary outline-none focus:border-glass-border focus:bg-bg-primary/60"
      />
      <ColorPicker
        value={
          (PLAN_COLOR_KEYS as readonly string[]).includes(org.color ?? "")
            ? (org.color as PlanColorKey)
            : null
        }
        onChange={onRecolor}
        compact
      />
      {org.is_default ? (
        <span className="shrink-0 rounded-full bg-glass-bg px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-text-muted">
          {t("settings.organizations.defaultBadge")}
        </span>
      ) : (
        <button
          type="button"
          onClick={onDelete}
          aria-label={t("settings.organizations.deleteOrg")}
          title={t("settings.organizations.deleteOrg")}
          className="shrink-0 rounded p-1.5 text-text-muted transition-colors hover:bg-red-500/10 hover:text-red-400 cursor-pointer"
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}

function ColorPicker({
  value,
  onChange,
  compact = false,
}: {
  value: PlanColorKey | null;
  onChange: (color: PlanColorKey | null) => void;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const buttonSize = compact ? "h-6 w-6" : "h-7 w-7";
  const dotSize = compact ? "h-3.5 w-3.5" : "h-4 w-4";
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", compact && "gap-1")}>
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-label={t("settings.organizations.colorNone")}
        title={t("settings.organizations.colorNone")}
        className={cn(
          "inline-flex items-center justify-center rounded-full border-2 transition-colors cursor-pointer",
          buttonSize,
          value === null
            ? "border-text-primary"
            : "border-transparent hover:border-glass-border",
        )}
      >
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full bg-glass-bg",
            dotSize,
          )}
        >
          <X size={compact ? 10 : 12} className="text-text-muted/70" />
        </span>
      </button>
      {PLAN_COLOR_KEYS.map((key) => {
        const cc = planColorClasses(key);
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            onClick={() => onChange(key)}
            aria-label={t(`settings.organizations.color.${key}`)}
            title={t(`settings.organizations.color.${key}`)}
            className={cn(
              "inline-flex items-center justify-center rounded-full border-2 transition-colors cursor-pointer",
              buttonSize,
              active
                ? "border-text-primary"
                : "border-transparent hover:border-glass-border",
            )}
          >
            <span className={cn("block rounded-full", dotSize, cc.swatch)} />
          </button>
        );
      })}
    </div>
  );
}
