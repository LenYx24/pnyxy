import { Link } from "react-router";
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
  return (
    <div className="space-y-4">
      <header>
        <h2 className="text-lg font-semibold text-text-primary">About</h2>
        <p className="text-sm text-text-muted">
          Project info and legal documents.
        </p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2">
        <LinkRow
          to="/about"
          icon={Info}
          label="About Pnyxy"
          description="What the project is and who's behind it."
        />
        <LinkRow
          to="/help"
          icon={HelpCircle}
          label="Help"
          description="Getting started and common questions."
        />
        <LinkRow
          to="/privacy"
          icon={Shield}
          label="Privacy Policy"
          description="What data we collect and how we use it."
        />
        <LinkRow
          to="/terms"
          icon={ScrollText}
          label="Terms of Service"
          description="The rules for using Pnyxy."
        />
      </div>
    </div>
  );
}
