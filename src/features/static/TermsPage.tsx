import { ScrollText } from "lucide-react";
import { useTranslation } from "react-i18next";

/**
 * First-pass Terms of Service. Draft, review before public launch.
 * Placeholders marked [TO FILL] must be completed.
 *
 * Body text is intentionally kept in English only, see PrivacyPage for
 * the same rationale.
 */
export function TermsPage() {
  const { t, i18n } = useTranslation();
  const showEnglishNotice = i18n.resolvedLanguage !== "en";
  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 p-4 sm:p-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-glass-bg">
          <ScrollText size={20} className="text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-text-primary">
            {t("static.terms.title")}
          </h1>
          <p className="text-xs text-text-muted">
            Last updated: 2026-04-21
          </p>
        </div>
      </div>

      {showEnglishNotice && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
          {t("static.terms.englishOnly")}
        </p>
      )}

      <section className="space-y-6 rounded-xl border border-glass-border bg-glass-bg/50 p-4 sm:p-6 text-sm leading-relaxed text-text-secondary">
        <p>
          These Terms govern your use of the Pnyxy service (the
          "Service"). By creating an account or otherwise using the
          Service, you agree to these Terms. If you do not agree,
          please do not use the Service.
        </p>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            1. Who we are
          </h2>
          <p>
            The Service is operated as a personal project by{" "}
            <strong>Foki Lénárd</strong>, based in Hungary ("we",
            "us"). Contact address:{" "}
            <span className="font-mono">Hungary, Bács-Kiskun megye, 6524 Dávod</span>.
            General support: <span className="font-mono">support@pnyxy.com</span>.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            2. Eligibility and age requirement
          </h2>
          <p>
            You must be at least <strong>16 years old</strong> to use
            the Service. If you are younger, you may not create an
            account. By using the Service you warrant that you meet
            this age requirement and have the legal capacity to enter
            into this agreement.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            3. Your account
          </h2>
          <p>
            You are responsible for keeping your credentials
            confidential and for all activity under your account.
            Notify us at{" "}
            <span className="font-mono">support@pnyxy.com</span>{" "}
            if you believe your account has been compromised. We may
            suspend or terminate accounts that violate these Terms,
            after reasonable notice where practicable.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            4. Your uploads ("Your Content")
          </h2>
          <p>
            You can upload PDF, EPUB, Markdown, and text files to your
            private library. You retain all rights you had in those
            files; uploading does not transfer any rights to us.
          </p>
          <p className="mt-2">
            <strong>Warranty.</strong> You represent and warrant that,
            for every file you upload, at least one of the following
            is true:
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>you authored the file yourself;</li>
            <li>the file is in the public domain;</li>
            <li>
              the file is licensed to you in a way that permits
              storing a personal copy (for example, under an open
              licence such as Creative Commons); or
            </li>
            <li>
              you have lawfully acquired a copy and are exercising
              your right to make a private copy for personal use
              (e.g. under Section 35 of Hungarian Act LXXVI of 1999
              on Copyright, or an equivalent right in your country).
            </li>
          </ul>
          <p className="mt-2">
            <strong>Privacy of uploads.</strong> Your uploaded files
            are stored in a private bucket. Database-level access
            controls restrict read access to your own account. We do
            not routinely read, scan, or share your uploads with
            other users. We may access them only where strictly
            necessary for technical maintenance, in response to a
            valid takedown notice concerning your account, or when
            required by law.
          </p>
          <p className="mt-2">
            <strong>Limited licence to us.</strong> You grant us a
            non-exclusive, royalty-free licence to host, store, back
            up, and transmit Your Content strictly for the purpose
            of providing the Service to you. This licence ends when
            you delete the content or your account.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            5. Community catalog (metadata sharing)
          </h2>
          <p>
            The Service allows you to submit the{" "}
            <em>metadata</em> of one of your uploaded books
            (title, authors, description, ISBN, categories) to a
            shared community catalog. This is opt-in per book and
            reviewed by an administrator before it appears publicly.
          </p>
          <p className="mt-2">
            The <em>binary file</em> is not shared by this action.
            Making the binary file itself publicly available is a
            separate administrative action, only taken for works
            whose licence clearly permits public redistribution
            (e.g., public-domain works, Creative Commons licences,
            or works the author has submitted for distribution).
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            6. Forum and other public content
          </h2>
          <p>
            If you post in the forum, leave public comments, or
            otherwise make content visible to other users ("Public
            Content"), you grant us a worldwide, non-exclusive,
            royalty-free licence to host, display, and transmit
            that content as part of the Service. You may delete
            your Public Content at any time, which ends this
            licence for future display.
          </p>
          <p className="mt-2">
            We may remove Public Content that violates these Terms
            or applicable law, at our discretion.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            7. AI features
          </h2>
          <p>
            The Service provides an AI chat assistant. When you use
            it, the text of the pages you are viewing and your
            conversation are transmitted to a third-party AI
            provider (currently OpenAI or Anthropic) so they can
            return a response.
          </p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            <li>
              Do not use the AI chat with any content you are not
              permitted to share with a third party.
            </li>
            <li>
              AI output can be inaccurate, biased, or out of date.
              Do not rely on it for medical, legal, financial, or
              other high-stakes decisions.
            </li>
            <li>
              Daily per-user and per-IP usage quotas apply to
              prevent abuse. Exceeding them returns a quota-error
              response.
            </li>
            <li>
              If you supply your own API key in settings, your use
              of the underlying provider is also governed by that
              provider's terms.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            8. Acceptable use
          </h2>
          <p>You agree not to:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>
              upload, share, or post content that you do not have the
              right to upload, share, or post;
            </li>
            <li>
              upload or distribute content that is illegal under
              Hungarian or EU law, including content that infringes
              intellectual property, incites violence, constitutes
              harassment, or involves the sexual exploitation of
              minors;
            </li>
            <li>
              attempt to reverse-engineer, disrupt, or overload the
              Service, circumvent access controls or quotas, or
              scrape the Service at scale;
            </li>
            <li>
              use the Service to spam, phish, or distribute malware;
            </li>
            <li>
              use the Service on behalf of a sanctioned party or in
              violation of applicable export-control rules.
            </li>
          </ul>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            9. Copyright and takedown requests
          </h2>
          <p>
            If you believe that content on the Service infringes your
            copyright, send a notice to{" "}
            <span className="font-mono">copyright@pnyxy.com</span>{" "}
            that includes:
          </p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            <li>
              your name, address, and a way to contact you;
            </li>
            <li>
              identification of the copyrighted work you claim has
              been infringed;
            </li>
            <li>
              a description of where the allegedly infringing
              content appears on the Service (URL or enough
              information to locate it);
            </li>
            <li>
              a statement, made in good faith, that the use is not
              authorised by the rights-holder or the law;
            </li>
            <li>
              a statement, under penalty of perjury (or equivalent
              standard in your jurisdiction), that the information
              is accurate and that you are the rights-holder or
              authorised to act on their behalf;
            </li>
            <li>your signature (physical or electronic).</li>
          </ul>
          <p className="mt-2">
            We process notices consistent with the EU Digital
            Services Act and applicable Hungarian copyright law. We
            may remove or restrict access to content pending review.
            Repeat infringers may have their accounts terminated.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            10. Storage tiers and paid features
          </h2>
          <p>
            The Service offers a free tier with limited storage. We
            may introduce paid tiers or paid features with higher
            limits or additional capabilities. Paid features, when
            available, will be subject to additional terms presented
            at the point of purchase, including pricing, renewal, and
            refund conditions.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            11. Intellectual property in the Service
          </h2>
          <p>
            The Pnyxy name, logos, user interface, and code are our
            property or licensed to us. These Terms do not grant you
            any rights in them beyond the right to use the Service
            as intended.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            12. Termination
          </h2>
          <p>
            You can stop using the Service and delete your account
            at any time from Settings. We may suspend or terminate
            your access if you materially breach these Terms, after
            giving you reasonable notice where practicable, or
            immediately if required by law or to protect the
            Service or other users. Sections that by their nature
            survive termination (including warranties, disclaimers,
            and limitation of liability) continue to apply.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            13. Disclaimers
          </h2>
          <p>
            The Service is provided on an "as-is" and "as-available"
            basis. To the extent permitted by law, we disclaim all
            warranties, express or implied, including the implied
            warranties of merchantability, fitness for a particular
            purpose, and non-infringement. We do not warrant that
            the Service will be uninterrupted, error-free, or that
            any data will not be lost.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            14. Limitation of liability
          </h2>
          <p>
            To the maximum extent permitted by law, we are not liable
            for indirect, incidental, consequential, or punitive
            damages; lost profits or data; or costs of procuring
            substitute services. Our aggregate liability arising out
            of or related to the Service is limited to the amount
            you paid us (if any) in the twelve months preceding the
            event giving rise to the liability, or EUR 50, whichever
            is greater.
          </p>
          <p className="mt-2">
            Nothing in these Terms limits liability that cannot be
            limited under applicable law, including liability for
            gross negligence, intentional misconduct, or rights
            granted to consumers under mandatory EU law.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            15. Governing law and disputes
          </h2>
          <p>
            These Terms are governed by the laws of Hungary, without
            regard to its conflict-of-laws rules. The Hungarian
            courts have exclusive jurisdiction over disputes arising
            from these Terms, subject to any mandatory consumer-law
            rights that grant you the right to bring a dispute
            before the courts of your place of residence.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            16. Changes to these Terms
          </h2>
          <p>
            We may update these Terms from time to time. If the
            changes are material, we will notify signed-in users in
            advance by email or in-app message. Continued use of
            the Service after the effective date constitutes
            acceptance of the updated Terms.
          </p>
        </div>

        <div>
          <h2 className="mb-2 text-base font-semibold text-text-primary">
            17. Contact
          </h2>
          <p>
            Questions or concerns about these Terms? Write to{" "}
            <span className="font-mono">support@pnyxy.com</span>.
          </p>
        </div>
      </section>
    </div>
  );
}
