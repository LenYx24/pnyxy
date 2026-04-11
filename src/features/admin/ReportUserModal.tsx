import { useState } from "react";
import { X, Flag, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/Button";
import { supabase } from "@/lib/supabase";
import { useAuthStore } from "@/stores/auth-store";
import type { ReportReason } from "@/types/database";

const REASONS: { value: ReportReason; label: string }[] = [
  { value: "spam", label: "Spam" },
  { value: "harassment", label: "Harassment" },
  { value: "inappropriate_content", label: "Inappropriate Content" },
  { value: "impersonation", label: "Impersonation" },
  { value: "other", label: "Other" },
];

interface ReportUserModalProps {
  reportedUserId: string;
  reportedUserName: string;
  onClose: () => void;
}

export function ReportUserModal({
  reportedUserId,
  reportedUserName,
  onClose,
}: ReportUserModalProps) {
  const { user } = useAuthStore();
  const [selected, setSelected] = useState<ReportReason[]>([]);
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const toggle = (reason: ReportReason) => {
    setSelected((prev) =>
      prev.includes(reason)
        ? prev.filter((r) => r !== reason)
        : [...prev, reason],
    );
  };

  const handleSubmit = async () => {
    if (!user || selected.length === 0) return;
    setSubmitting(true);
    setError(null);

    const { error: err } = await supabase.from("user_reports").insert({
      reporter_id: user.id,
      reported_user_id: reportedUserId,
      reasons: selected,
      message: message.trim() || null,
    });

    setSubmitting(false);

    if (err) {
      setError(
        err.code === "23505"
          ? "You already have a pending report for this user."
          : err.message,
      );
      return;
    }

    setSuccess(true);
    setTimeout(onClose, 1500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-xl border border-glass-border bg-bg-secondary/95 backdrop-blur-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-glass-border px-6 py-4">
          <div className="flex items-center gap-2">
            <Flag size={18} className="text-red-400" />
            <h2 className="text-lg font-semibold text-text-primary">
              Report User
            </h2>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-text-muted transition-colors hover:bg-glass-hover hover:text-text-primary"
          >
            <X size={18} />
          </button>
        </div>

        <div className="p-6">
          {success ? (
            <p className="text-center text-green-400">
              Report submitted. Thank you.
            </p>
          ) : (
            <>
              <p className="mb-4 text-sm text-text-secondary">
                Report <strong className="text-text-primary">{reportedUserName}</strong> for:
              </p>

              <div className="mb-4 flex flex-wrap gap-2">
                {REASONS.map(({ value, label }) => (
                  <button
                    key={value}
                    onClick={() => toggle(value)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer",
                      selected.includes(value)
                        ? "border-accent-purple bg-accent-purple/15 text-accent-purple"
                        : "border-glass-border bg-glass-bg text-text-secondary hover:bg-glass-hover",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Additional details (optional)"
                rows={3}
                className="mb-4 w-full resize-none rounded-lg border border-glass-border bg-glass-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent-purple focus:outline-none"
              />

              {error && (
                <p className="mb-3 text-sm text-red-400">{error}</p>
              )}

              <div className="flex justify-end gap-2">
                <Button variant="ghost" onClick={onClose}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  onClick={handleSubmit}
                  disabled={submitting || selected.length === 0}
                >
                  {submitting ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    "Submit Report"
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
