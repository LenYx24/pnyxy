import { Shield } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * First-pass privacy notice. Draft — review before public launch.
 * Placeholders marked [TO FILL] must be completed.
 *
 * Body text is intentionally kept in English only: a legal document
 * shouldn't be machine- or AI-translated without legal review. The
 * Hungarian banner explains this to non-English readers.
 */
export function PrivacyPage() {
  const { t, i18n } = useTranslation();
  const showEnglishNotice = i18n.resolvedLanguage !== "en";
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
          <Shield size={20} className="text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            {t("static.privacy.title")}
          </h1>
          <p className="text-xs text-text-muted">
            Last updated: 2026-04-21
          </p>
        </div>
      </div>

      {showEnglishNotice && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          {t("static.privacy.englishOnly")}
        </p>
      )}

      <section className="space-y-6 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6 text-sm leading-relaxed text-text-secondary">
        <p>
          This policy explains what personal data Pnyxy processes, why,
          and the choices you have. It is written in plain language.
          Where we reference legal bases, they correspond to the EU
          General Data Protection Regulation (GDPR, Regulation (EU)
          2016/679) and its Hungarian implementation under Act CXII of
          2011 on Informational Self-Determination and Freedom of
          Information.
        </p>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            1. Who we are
          </h2>
          <p>
            The service "Pnyxy" (the "Service") is operated as a personal
            project by <strong>Foki Lénárd</strong>, based in Hungary
            (the "Controller", "we", or "us"). Contact address:{" "}
            <span className="font-mono">Hungary, Bács-Kiskun megye, 6524 Dávod</span>.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Privacy requests:{" "}
              <span className="font-mono">privacy@pnyxy.com</span>
            </li>
            <li>
              Copyright / takedown:{" "}
              <span className="font-mono">copyright@pnyxy.com</span>
            </li>
            <li>
              Other enquiries:{" "}
              <span className="font-mono">support@pnyxy.com</span>
            </li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            2. What we process and why
          </h2>
          <p>We process the following categories of personal data:</p>

          <h3 className="mt-3 text-sm font-semibold text-text-primary">
            2.1 Account data
          </h3>
          <p>
            Email address, display name, optional avatar, and — if you
            sign in with Google — a Google account identifier. Collected
            to create and secure your account. Legal basis: performance
            of a contract (Art. 6(1)(b) GDPR).
          </p>

          <h3 className="mt-3 text-sm font-semibold text-text-primary">
            2.2 Content you create or upload
          </h3>
          <p>
            Books you upload, reading position, annotations, highlights,
            comments, notes, whiteboard drawings, tags, folders, and
            forum posts. Uploaded files are stored in a private
            per-user bucket and are not readable by other users. Legal
            basis: performance of a contract (Art. 6(1)(b) GDPR).
          </p>

          <h3 className="mt-3 text-sm font-semibold text-text-primary">
            2.3 AI-chat data
          </h3>
          <p>
            When you use the AI chat, the text of the pages you are
            currently viewing, your prompt, and your conversation are
            sent to an upstream AI provider (OpenAI or Anthropic). If
            you are signed in, we log per-day token usage against your
            account to enforce daily quotas. If you use the chat
            without an account, we hash your IP address with a server
            secret and use the hash solely as a per-day quota key — the
            original IP is not stored. Legal basis: performance of a
            contract and our legitimate interest in preventing abuse
            (Art. 6(1)(b) and (f) GDPR).
          </p>

          <h3 className="mt-3 text-sm font-semibold text-text-primary">
            2.4 Usage data
          </h3>
          <p>
            Reading streaks and cumulative reading time, stored against
            your account to power streak features. Basic server and
            hosting logs (including IP address, user agent, and
            request metadata) are created by our hosting providers for
            security and diagnostics. Legal basis: legitimate interest
            in the secure and reliable operation of the Service (Art.
            6(1)(f) GDPR).
          </p>

          <h3 className="mt-3 text-sm font-semibold text-text-primary">
            2.5 Preferences
          </h3>
          <p>
            View mode, cover size, enabled plugins, theme, sort order,
            and similar UI preferences are stored locally on your
            device in the browser's localStorage. A subset may be
            synced to your account for cross-device continuity.
          </p>

          <h3 className="mt-3 text-sm font-semibold text-text-primary">
            2.6 Analytics
          </h3>
          <p>
            We do not use third-party analytics or advertising
            trackers. We do not sell personal data.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            3. Service providers (sub-processors)
          </h2>
          <p>
            We rely on the following service providers to run Pnyxy.
            Each processes personal data only on our instructions and
            under a data processing agreement.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              <strong>Supabase Inc.</strong> — database, authentication,
              file storage, edge functions. Hosting region configured
              by us.
            </li>
            <li>
              <strong>Cloudflare, Inc.</strong> — static hosting (Workers
              Assets) and CDN.
            </li>
            <li>
              <strong>Google LLC</strong> — OAuth sign-in, if you choose
              to sign in with Google.
            </li>
            <li>
              <strong>OpenAI, L.L.C.</strong> and{" "}
              <strong>Anthropic, PBC</strong> — AI chat providers. Only
              the specific content and prompt you submit through the AI
              chat is sent; by default these providers do not train on
              API inputs, though you should review their current terms.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            4. International transfers
          </h2>
          <p>
            Some of our sub-processors are established outside the EEA
            (notably in the United States). Where personal data is
            transferred outside the EEA, transfers are covered by
            Standard Contractual Clauses adopted by the European
            Commission, or by equivalent safeguards published by those
            providers.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            5. How long we keep data
          </h2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Account data and user content: kept while your account is
              active. Deleted within 30 days after you delete your
              account (backups expire within a further 30 days).
            </li>
            <li>
              AI usage records: purged after 30 days (aggregate stats
              may be retained in anonymised form).
            </li>
            <li>
              Hosting logs: retained for up to 30 days by the hosting
              provider for security purposes.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            6. Your rights
          </h2>
          <p>
            If you are in the EEA or the UK you have, under GDPR, the
            right to: access your data (Art. 15), have it corrected
            (Art. 16) or erased (Art. 17), restrict processing (Art.
            18), receive a portable copy (Art. 20), and object to
            processing based on legitimate interest (Art. 21). You can
            exercise these rights from inside the Service or by
            emailing <span className="font-mono">privacy@pnyxy.com</span>.
          </p>
          <p className="mt-2">
            You may also lodge a complaint with a supervisory
            authority. In Hungary this is the{" "}
            <em>
              Nemzeti Adatvédelmi és Információszabadság Hatóság (NAIH)
            </em>{" "}
            — <span className="font-mono">naih.hu</span>.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            7. Cookies and local storage
          </h2>
          <p>
            We do not set tracking cookies. Authentication uses a
            session cookie set by Supabase, strictly necessary for
            keeping you signed in. We use the browser's localStorage to
            store your UI preferences — not for tracking.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            8. Children
          </h2>
          <p>
            The Service is not intended for children under 16. We do
            not knowingly collect data from children under this age. If
            you believe a child has provided us data, please contact{" "}
            <span className="font-mono">privacy@pnyxy.com</span> and we
            will delete the account.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            9. Security
          </h2>
          <p>
            Data is transmitted over TLS. At rest, data is stored on
            infrastructure operated by Supabase and Cloudflare, which
            apply industry-standard physical and technical safeguards.
            Row-level security policies enforce that your uploaded
            files and content can only be read by you.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            10. Changes to this policy
          </h2>
          <p>
            We may update this policy from time to time. If the changes
            are material we will notify signed-in users by email or
            in-app message before they take effect. The "last updated"
            date above reflects the latest version.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            11. Contact
          </h2>
          <p>
            Questions about this policy or about how your data is
            handled? Write to{" "}
            <span className="font-mono">privacy@pnyxy.com</span>.
          </p>
        </div>
      </section>
    </div>
  );
}
