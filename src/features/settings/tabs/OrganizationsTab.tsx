import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { AlertTriangle, Loader2, Plus, Trash2, X } from "lucide-react";
import { Button, IconButton, modalBackdropClass, modalSurfaceClass } from "@/components/ui";
import { SettingsSection } from "../ui";
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
  const fetchError = useOrgStore((s) => s.error);
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
      <SettingsSection>
        <p className="py-3 text-center text-[13px] text-text-muted">
          {t("settings.organizationsSection.signInFirst")}
        </p>
      </SettingsSection>
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
    <SettingsSection
      description={t("settings.organizationsSection.description")}
      plain
    >
      <div className="space-y-4">
      <p className="rounded-control bg-bg-tertiary px-4 py-3 text-[13px] text-text-secondary">
        {t("settings.organizationsSection.scopingNotice")}
      </p>

      {error && (
        <p className="rounded-control bg-danger/10 px-4 py-3 text-[13px] text-danger">
          {error}
        </p>
      )}

      {/* Existing orgs */}
      <div className="space-y-2">
        {isLoading && organizations.length === 0 ? (
          <div className="flex items-center gap-2 text-xs text-text-muted">
            <Loader2 size={14} className="animate-spin" />
            {t("common.loading")}
          </div>
        ) : fetchError && organizations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-panel bg-bg-tertiary px-4 py-6 text-center">
            <AlertTriangle size={22} className="text-warning" />
            <p className="text-xs text-text-muted">
              {t("settings.organizationsSection.loadFailed")}
            </p>
            <Button variant="secondary" size="sm" onClick={() => fetchMine()}>
              {t("common.retry")}
            </Button>
          </div>
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
        <div className="space-y-3 rounded-panel bg-bg-tertiary p-4">
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-text-secondary">
              {t("settings.organizationsSection.nameLabel")}
            </label>
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={t("settings.organizationsSection.namePlaceholder")}
              maxLength={60}
              autoFocus
              className="field bg-bg-secondary"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-text-secondary">
              {t("settings.organizationsSection.colorLabel")}
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
              {t("settings.organizationsSection.create")}
            </Button>
          </div>
        </div>
      ) : (
        <Button variant="secondary" onClick={() => setCreating(true)}>
          <Plus size={14} />
          {t("settings.organizationsSection.newOrg")}
        </Button>
      )}

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div
            className={cn("absolute inset-0", modalBackdropClass)}
            onClick={() => setConfirmDelete(null)}
          />
          <div className={cn("relative z-10 w-full max-w-sm p-6", modalSurfaceClass)}>
            <h3 className="mb-2 font-display text-lg font-semibold text-text-primary">
              {t("settings.organizationsSection.confirmDeleteTitle", {
                name: confirmDelete.name,
              })}
            </h3>
            <p className="mb-4 text-sm text-text-muted">
              {t("settings.organizationsSection.confirmDeleteBody")}
            </p>
            <div className="flex justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => setConfirmDelete(null)}
                disabled={deleting}
              >
                {t("common.cancel")}
              </Button>
              <Button variant="danger" onClick={handleDelete} disabled={deleting}>
                {deleting
                  ? t("common.deleting")
                  : t("settings.organizationsSection.deleteOrg")}
              </Button>
            </div>
          </div>
        </div>
      )}
      </div>
    </SettingsSection>
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
    <div className="flex flex-col gap-2 rounded-panel bg-bg-tertiary p-3 sm:flex-row sm:items-center">
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
        className="field min-w-0 flex-1 bg-transparent py-1.5 hover:bg-bg-secondary"
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
        <span className="chip shrink-0 px-2 py-0.5 text-2xs uppercase tracking-wider">
          {t("settings.organizationsSection.defaultBadge")}
        </span>
      ) : (
        <IconButton
          variant="danger"
          size="sm"
          onClick={onDelete}
          aria-label={t("settings.organizationsSection.deleteOrg")}
          title={t("settings.organizationsSection.deleteOrg")}
          className="shrink-0"
        >
          <Trash2 size={14} />
        </IconButton>
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
        aria-label={t("settings.organizationsSection.colorNone")}
        title={t("settings.organizationsSection.colorNone")}
        className={cn(
          "inline-flex items-center justify-center rounded-full border-2 transition-colors cursor-pointer",
          buttonSize,
          value === null
            ? "border-text-primary"
            : "border-transparent hover:border-surface-3",
        )}
      >
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full bg-surface-3",
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
            aria-label={t(`settings.organizationsSection.color.${key}`)}
            title={t(`settings.organizationsSection.color.${key}`)}
            className={cn(
              "inline-flex items-center justify-center rounded-full border-2 transition-colors cursor-pointer",
              buttonSize,
              active
                ? "border-text-primary"
                : "border-transparent hover:border-surface-3",
            )}
          >
            <span className={cn("block rounded-full", dotSize, cc.swatch)} />
          </button>
        );
      })}
    </div>
  );
}
