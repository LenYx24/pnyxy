import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { Info, ScrollText, Shield, HelpCircle, ArrowUpRight } from "lucide-react";
import { SettingsSection } from "../ui";

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
      className="group flex items-center gap-3 rounded-panel bg-bg-tertiary p-4 transition-colors hover:bg-surface-3"
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-surface-3 text-text-secondary group-hover:bg-bg-tertiary">
        <Icon size={20} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[15px] font-medium text-text-primary">{label}</p>
        <p className="text-[13px] text-text-muted">{description}</p>
      </div>
      <ArrowUpRight
        size={16}
        className="shrink-0 text-text-muted opacity-0 transition-opacity group-hover:opacity-100"
      />
    </Link>
  );
}

export function AboutTab() {
  const { t } = useTranslation();
  return (
    <SettingsSection
      description={t("settings.aboutSection.description")}
      plain
    >
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
    </SettingsSection>
  );
}
