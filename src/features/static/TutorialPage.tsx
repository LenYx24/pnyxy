import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import {
  Bot,
  BrainCircuit,
  Compass,
  GraduationCap,
  HelpCircle,
  Keyboard,
  Library,
  MessagesSquare,
  Rocket,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";

interface Section {
  id: string;
  icon: LucideIcon;
}

// Section ordering matches the user's first-time journey: get a book
// in, read it, talk to it, drill it, plan around it, then community
// and power tips. Anchor ids double as TOC link targets.
const SECTIONS: Section[] = [
  { id: "quickStart", icon: Rocket },
  { id: "reading", icon: Library },
  { id: "aiChat", icon: Bot },
  { id: "activeRecall", icon: BrainCircuit },
  { id: "planTrack", icon: GraduationCap },
  { id: "community", icon: MessagesSquare },
  { id: "powerTips", icon: Keyboard },
];

export function TutorialPage() {
  const { t } = useTranslation();

  return (
    <div className="mx-auto w-full max-w-5xl p-4 sm:p-6">
      <header className="mb-8">
        <div className="mb-2 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
            <Compass size={20} className="text-accent" />
          </div>
          <h1 className="text-2xl font-bold text-text-primary sm:text-3xl">
            {t("static.tutorial.title")}
          </h1>
        </div>
        <p className="max-w-2xl text-sm text-text-secondary">
          {t("static.tutorial.intro")}
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-[12rem_1fr]">
        {/* Sticky TOC — desktop only. The sections are short enough
            that scrolling is fine, but jumping around is faster when
            the user knows what they're looking for. */}
        <aside className="hidden lg:block">
          <nav
            className="sticky top-4 space-y-1 text-sm"
            aria-label={t("static.tutorial.tocLabel")}
          >
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-text-muted">
              {t("static.tutorial.tocTitle")}
            </p>
            {SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="block rounded px-2 py-1 text-text-secondary hover:bg-glass-hover hover:text-text-primary"
              >
                {t(`static.tutorial.sections.${s.id}.title`)}
              </a>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 space-y-10">
          {SECTIONS.map((section) => (
            <TutorialSection key={section.id} section={section} />
          ))}

          {/* Footer CTA — points at the help page for FAQs and at the
              GitHub link in the site footer for issue reports. */}
          <section className="rounded-xl border border-glass-border bg-glass-bg/50 p-5 text-sm leading-relaxed text-text-secondary">
            <div className="mb-2 flex items-center gap-2">
              <HelpCircle size={16} className="text-accent" />
              <h2 className="text-base font-semibold text-text-primary">
                {t("static.tutorial.footer.title")}
              </h2>
            </div>
            <p>
              {t("static.tutorial.footer.bodyPrefix")}
              <Link
                to="/help"
                className="text-accent hover:underline"
              >
                {t("static.tutorial.footer.helpLink")}
              </Link>
              {t("static.tutorial.footer.bodySuffix")}
            </p>
          </section>
        </main>
      </div>
    </div>
  );
}

function TutorialSection({ section }: { section: Section }) {
  const { t } = useTranslation();
  const Icon = section.icon;
  const id = section.id;
  // Each section i18n block has an array of bullet points under
  // `bullets`. We don't know the count at compile time, so iterate
  // until we hit an unset key and stop. Capped at 6 to keep authors
  // honest about scope.
  const bullets: string[] = [];
  for (let i = 0; i < 6; i++) {
    const key = `static.tutorial.sections.${id}.bullets.${i}`;
    const v = t(key);
    if (v === key) break;
    bullets.push(v);
  }

  return (
    <section
      id={id}
      // scroll-mt offsets the anchor jump so the section heading
      // doesn't end up flush with the viewport top.
      className="scroll-mt-6"
    >
      <div className="mb-3 flex items-center gap-2">
        <div
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-lg",
            "bg-accent/10 text-accent",
          )}
        >
          <Icon size={18} />
        </div>
        <h2 className="text-xl font-semibold text-text-primary">
          {t(`static.tutorial.sections.${id}.title`)}
        </h2>
      </div>
      <p className="mb-3 text-sm leading-relaxed text-text-secondary">
        {t(`static.tutorial.sections.${id}.body`)}
      </p>
      {bullets.length > 0 && (
        <ul className="ml-1 list-inside list-disc space-y-1 text-sm leading-relaxed text-text-secondary">
          {bullets.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
