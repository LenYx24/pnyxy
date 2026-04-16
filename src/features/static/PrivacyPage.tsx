import { Shield } from "lucide-react";

export function PrivacyPage() {
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
          <Shield size={20} className="text-accent-purple" />
        </div>
        <h1 className="text-2xl font-bold text-text-primary">
          Privacy Notice
        </h1>
      </div>

      <section className="space-y-4 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6 text-sm leading-relaxed text-text-secondary">
        <div>
          <h2 className="mb-1 text-base font-semibold text-text-primary">
            What we store
          </h2>
          <p>
            Your library, reading progress, and app settings are stored
            locally in your browser. If you sign in, the following are
            synced to our server: your email, display name, avatar, and
            a subset of preferences (theme, enabled plugins, tags).
          </p>
        </div>

        <div>
          <h2 className="mb-1 text-base font-semibold text-text-primary">
            Uploaded documents
          </h2>
          <p>
            Documents you upload are stored in your private storage
            bucket. They are not readable by other users unless you
            explicitly share them with the community library.
          </p>
        </div>

        <div>
          <h2 className="mb-1 text-base font-semibold text-text-primary">
            Analytics
          </h2>
          <p>
            We do not use third-party analytics. Reading stats such as
            streak data are computed and stored locally on your device.
          </p>
        </div>

        <div>
          <h2 className="mb-1 text-base font-semibold text-text-primary">
            Account deletion
          </h2>
          <p>
            You can delete your account from Settings. This removes
            your profile, uploaded documents, and all synced
            preferences from our servers.
          </p>
        </div>
      </section>
    </div>
  );
}
