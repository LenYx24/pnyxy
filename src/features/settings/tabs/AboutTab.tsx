import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Info, ScrollText, Shield, HelpCircle, ExternalLink } from "lucide-react";

interface LinkRowProps {
  to: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  description: string;
}

function LinkRow({ to, icon: Icon, label, description }: LinkRowProps) {
  return (
    <Link
      to={to}
      className="group flex items-center gap-3 rounded-xl border border-glass-border bg-glass-bg/50 p-4 transition-colors hover:bg-glass-hover"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent-purple/15 text-accent-purple">
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-text-primary">{label}</p>
        <p className="text-xs text-text-muted">{description}</p>
      </div>
      <ExternalLink
        size={14}
        className="shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100"
      />
    </Link>
  );
}

export function AboutTab() {
  const { t } = useTranslation();
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-text-primary">
          {t("settings.aboutSection.heading")}
        </h2>
        <p className="text-sm text-text-muted">
          {t("settings.aboutSection.description")}
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <LinkRow
          to="/about"
          icon={Info}
          label={t("settings.aboutSection.about")}
          description={t("settings.aboutSection.aboutHint")}
        />
        <LinkRow
          to="/help"
          icon={HelpCircle}
          label={t("settings.aboutSection.help")}
          description={t("settings.aboutSection.helpHint")}
        />
        <LinkRow
          to="/privacy"
          icon={Shield}
          label={t("settings.aboutSection.privacy")}
          description={t("settings.aboutSection.privacyHint")}
        />
        <LinkRow
          to="/terms"
          icon={ScrollText}
          label={t("settings.aboutSection.terms")}
          description={t("settings.aboutSection.termsHint")}
        />
      </div>
    </div>
  );
}
