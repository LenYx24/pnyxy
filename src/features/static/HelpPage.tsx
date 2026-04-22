import { HelpCircle } from "lucide-react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";

export function HelpPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
          <HelpCircle size={20} className="text-accent-purple" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">
          {t("static.help.title")}
        </h1>
      </div>

      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6 text-sm leading-relaxed text-text-secondary">
        <div>
          <h2 className="mb-1 text-base font-semibold text-text-primary">
            {t("static.help.opening.heading")}
          </h2>
          <p>{t("static.help.opening.body")}</p>
        </div>

        <div>
          <h2 className="mb-1 text-base font-semibold text-text-primary">
            {t("static.help.find.heading")}
          </h2>
          <p>
            {t("static.help.find.bodyPrefix")}
            <kbd className="rounded bg-glass-bg px-1.5 py-0.5 text-xs">
              Ctrl+F
            </kbd>
            {t("static.help.find.bodyInfix")}
            <kbd className="rounded bg-glass-bg px-1.5 py-0.5 text-xs">
              Ctrl+H
            </kbd>
            {t("static.help.find.bodySuffix")}
          </p>
        </div>

        <div>
          <h2 className="mb-1 text-base font-semibold text-text-primary">
            {t("static.help.shortcuts.heading")}
          </h2>
          <p>
            {t("static.help.shortcuts.bodyPrefix")}
            <Link
              to="/settings/shortcuts"
              className="text-accent-purple hover:underline"
            >
              {t("static.help.shortcuts.link")}
            </Link>
            {t("static.help.shortcuts.bodySuffix")}
          </p>
        </div>

        <div>
          <h2 className="mb-1 text-base font-semibold text-text-primary">
            {t("static.help.reporting.heading")}
          </h2>
          <p>{t("static.help.reporting.body")}</p>
        </div>
      </section>
    </div>
  );
}
