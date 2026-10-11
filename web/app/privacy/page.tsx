import type { Metadata } from 'next';
import { Card, H2, Page } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Privacy Policy | Contest Scoreboard',
  description: 'How Oberon handles personal information for the Contest Scoreboard.',
  robots: { index: false, follow: false },
};

export default function PrivacyPage() {
  return (
    <Page>
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-sky-200">Oberon</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Privacy Policy</h1>
        <p className="text-sm text-slate-500">Effective 11 October 2026</p>
      </header>

      <Card className="space-y-6 text-sm leading-7 text-slate-700">
        <p>
          This policy describes how Oberon, the contest organiser (“we”, “us”), handles personal
          information when you register for or use the Contest Scoreboard. We act as the data
          controller for information used to administer this contest. For privacy questions or
          requests, email{' '}
          <a className="font-medium underline" href="mailto:titanunhinged@gmail.com">
            titanunhinged@gmail.com
          </a>.
        </p>

        <section>
          <H2>Information we use</H2>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Registration and account information, including your email address, display name,
              account identifiers, and account status.
            </li>
            <li>
              Contest activity, including categories, references, notes, screenshots or other
              image proof, submission status, review decisions, scores, and audit records.
            </li>
            <li>
              Security and service information, such as authentication/session data, failed-login
              records, and email address and IP address used for rate-limiting key resend requests.
            </li>
            <li>
              Basic technical information processed by the website host and service providers to
              deliver, maintain, and protect the service.
            </li>
          </ul>
        </section>

        <section>
          <H2>How and why we use it</H2>
          <p>We use this information to:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>register participants, provide account access, and send or replace login keys;</li>
            <li>receive and review submissions, administer scores, and display the leaderboard;</li>
            <li>respond to questions, manage the contest, and maintain audit and dispute records;</li>
            <li>protect accounts and the service, including limiting abusive or automated requests.</li>
          </ul>
          <p className="mt-2">
            Under UK data protection law, we rely on the need to provide and administer
            participation in the contest, our legitimate interests in running a fair and secure
            contest, and legal obligations where they apply. We do not use participant details for
            advertising or sell personal information.
          </p>
        </section>

        <section>
          <H2>Leaderboard and screenshots</H2>
          <p>
            Other signed-in participants can see your display name, points, completed tasks, and
            rank. They cannot see your email address or proof screenshots through the leaderboard.
            Screenshots are stored in private storage and are available only as needed for
            submission review. When an administrator archives a contest, the service deletes its
            stored proof screenshots.
          </p>
        </section>

        <section>
          <H2>Service providers and sharing</H2>
          <p>
            We use service providers to operate the contest: Supabase for authentication, database,
            and private image storage; Vercel to host the website; and Google Forms, Sheets, Apps
            Script, and email services for registration administration and login-key delivery.
            These providers process information on our behalf or under their own service terms.
            We may also disclose information when required by law or when reasonably necessary to
            protect participants, the contest, or the service. We do not sell or rent participant
            information.
          </p>
          <p className="mt-2">
            These providers may process information in countries outside the UK. Where UK data
            protection law requires safeguards for an international transfer, we rely on the
            applicable safeguards offered by the provider.
          </p>
        </section>

        <section>
          <H2>Retention</H2>
          <p>
            Account details, submission records, scores, and audit records do not have an
            automatic deletion date. We retain them until the contest organiser deletes them, for
            contest administration and record-keeping. Proof screenshots are deleted when the
            contest is archived. Resend-request email and IP records older than two days, and
            failed-login records older than two days, are cleaned up when a later request or
            failed login triggers the cleanup routine; they may remain longer if no such activity
            occurs. Failed-login rate limits use a 24-hour window. Backups or provider logs may
            persist for a limited period under the relevant provider’s retention practices.
          </p>
        </section>

        <section>
          <H2>Cookies and local storage</H2>
          <p>
            The service uses strictly necessary authentication cookies to keep you signed in.
            The admin area also uses browser local storage to support automatic logout after
            inactivity. We do not configure advertising or analytics cookies in the website.
          </p>
        </section>

        <section>
          <H2>Your rights</H2>
          <p>
            Depending on the circumstances, UK data protection law gives you rights to request
            access to, correction of, or deletion of your personal information, or to object to or
            restrict certain uses. You may also have a right to receive information you provided
            in a portable format. To exercise a right, contact us at{' '}
            <a className="font-medium underline" href="mailto:titanunhinged@gmail.com">
              titanunhinged@gmail.com
            </a>. We may need to verify your identity and some rights are subject to legal
            exceptions. You can complain to the UK Information Commissioner’s Office at{' '}
            <a className="font-medium underline" href="https://ico.org.uk/make-a-complaint/">
              ico.org.uk
            </a>.
          </p>
        </section>

        <section>
          <H2>Security and updates</H2>
          <p>
            We use access controls and other reasonable measures to protect information. No
            internet service can be guaranteed completely secure. We may update this policy by
            publishing a new version here. For questions or privacy requests, contact{' '}
            <a className="font-medium underline" href="mailto:titanunhinged@gmail.com">
              titanunhinged@gmail.com
            </a>.
          </p>
        </section>
      </Card>
    </Page>
  );
}
