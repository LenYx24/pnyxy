import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { ArrowUp, ArrowDown, ExternalLink, Loader2, Save } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { logError } from "@/lib/logger";
import { showToast } from "@/stores/toast-store";
import { Button } from "@/components/ui";
import { AI_MODEL_CATALOG } from "@/lib/ai/ai-models";
import { cn } from "@/lib/cn";

interface ConfigRow {
  model_key: string;
  enabled: boolean;
  sort_order: number;
  price_input_per_mtok: number | null;
  price_output_per_mtok: number | null;
}

/** Admin view over the LLM offering. The model definitions live in code
 *  (ai-models.ts); this edits the DB-backed config (public.ai_model_config):
 *  which models are offered, their order in the picker, and their approximate
 *  price. Usage numbers live on the AI Quota tab. */
export function ModelsTab() {
  const [rows, setRows] = useState<ConfigRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const catalogByKey = useMemo(
    () => new Map(AI_MODEL_CATALOG.map((m) => [m.provider, m])),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("ai_model_config")
        .select(
          "model_key, enabled, sort_order, price_input_per_mtok, price_output_per_mtok",
        );
      if (cancelled) return;
      if (error) {
        logError("admin:models:load", error);
        setLoading(false);
        return;
      }
      const config = new Map(
        (data ?? []).map((r) => [r.model_key as string, r as ConfigRow]),
      );
      // Merge: every catalog model gets a row, config overlays defaults.
      const merged: ConfigRow[] = AI_MODEL_CATALOG.map((m, i) => {
        const c = config.get(m.provider);
        return {
          model_key: m.provider,
          enabled: c?.enabled ?? true,
          sort_order: c?.sort_order ?? i,
          price_input_per_mtok: c?.price_input_per_mtok ?? null,
          price_output_per_mtok: c?.price_output_per_mtok ?? null,
        };
      }).sort((a, b) => a.sort_order - b.sort_order);
      setRows(merged);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (key: string, patch: Partial<ConfigRow>) => {
    setRows((rs) => rs.map((r) => (r.model_key === key ? { ...r, ...patch } : r)));
    setDirty(true);
  };

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= rows.length) return;
    setRows((rs) => {
      const next = [...rs];
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((r, i) => ({ ...r, sort_order: i }));
    });
    setDirty(true);
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = rows.map((r, i) => ({ ...r, sort_order: i }));
      const { error } = await supabase
        .from("ai_model_config")
        .upsert(payload, { onConflict: "model_key" });
      if (error) throw error;
      setDirty(false);
      showToast("Model settings saved.", "success");
    } catch (err) {
      logError("admin:models:save", err);
      showToast("Couldn't save model settings.", "error");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 p-10 text-sm text-text-muted">
        <Loader2 size={16} className="animate-spin" />
        Loading models…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">Models</h2>
          <p className="text-sm text-text-secondary">
            Which LLMs are offered in the chat, their order in the picker, and
            their approximate price. Model definitions live in code; this is the
            editable config.
          </p>
        </div>
        <Button variant="primary" onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          Save changes
        </Button>
      </div>

      <div className="overflow-x-auto rounded-panel border border-glass-border">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-glass-border text-left text-xs uppercase tracking-wide text-text-muted-2">
              <th className="px-3 py-2 font-medium">Order</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Enabled</th>
              <th className="px-3 py-2 font-medium">Input $/1M</th>
              <th className="px-3 py-2 font-medium">Output $/1M</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const meta = catalogByKey.get(
                row.model_key as (typeof AI_MODEL_CATALOG)[number]["provider"],
              );
              return (
                <tr
                  key={row.model_key}
                  className={cn(
                    "border-b border-glass-border/60 last:border-0",
                    !row.enabled && "opacity-55",
                  )}
                >
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => move(i, -1)}
                        disabled={i === 0}
                        aria-label="Move up"
                        className="rounded p-1 text-text-muted hover:bg-glass-hover hover:text-text-primary disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(i, 1)}
                        disabled={i === rows.length - 1}
                        aria-label="Move down"
                        className="rounded p-1 text-text-muted hover:bg-glass-hover hover:text-text-primary disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-text-primary">
                      {meta?.displayName ?? row.model_key}
                    </div>
                    <div className="text-2xs text-text-muted">
                      {row.model_key}
                      {meta ? ` · ${meta.modelId} · ${meta.power}` : null}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={row.enabled}
                      onChange={(e) =>
                        update(row.model_key, { enabled: e.target.checked })
                      }
                      className="h-4 w-4 cursor-pointer accent-accent"
                      aria-label={`${meta?.displayName ?? row.model_key} enabled`}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <PriceInput
                      value={row.price_input_per_mtok}
                      onChange={(v) =>
                        update(row.model_key, { price_input_per_mtok: v })
                      }
                    />
                  </td>
                  <td className="px-3 py-2">
                    <PriceInput
                      value={row.price_output_per_mtok}
                      onChange={(v) =>
                        update(row.model_key, { price_output_per_mtok: v })
                      }
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-text-muted">
        Per-model usage (who uses what, tokens, quota ceilings) is on the{" "}
        <Link
          to="/admin/quota"
          className="inline-flex items-center gap-1 text-accent hover:underline"
        >
          AI Quota tab <ExternalLink size={11} />
        </Link>
        . Adding a whole new model still needs a code change in{" "}
        <code className="rounded bg-surface-3 px-1 py-0.5 text-2xs">
          src/lib/ai/ai-models.ts
        </code>
        .
      </p>
    </div>
  );
}

function PriceInput({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <input
      type="number"
      min={0}
      step="0.01"
      inputMode="decimal"
      value={value ?? ""}
      placeholder="free"
      onChange={(e) => {
        const raw = e.target.value.trim();
        onChange(raw === "" ? null : Number(raw));
      }}
      className="field w-24 px-2 py-1 text-sm"
    />
  );
}
