import { useTranslation } from "react-i18next";
import { Info } from "lucide-react";

export function AboutPage() {
  const { t } = useTranslation();
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
          <Info size={20} className="text-accent" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">
          {t("static.about.title")}
        </h1>
      </div>

      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6 text-sm leading-relaxed text-text-secondary">
        <p>{t("static.about.p1")}</p>
        <p>{t("static.about.p2")}</p>
        <p>{t("static.about.p3")}</p>
      </section>
    </div>
  );
}
