import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, H2, Page } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Terms of Use | Contest Scoreboard',
  description: 'Terms for using the Contest Scoreboard.',
  robots: { index: false, follow: false },
};

export default function TermsPage() {
  return (
    <Page>
      <header className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.18em] text-sky-200">Oberon</p>
        <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Terms of Use</h1>
        <p className="text-sm text-slate-500">Effective 11 October 2026</p>
      </header>

      <Card className="space-y-6 text-sm leading-7 text-slate-700">
        <p>
          These terms apply when you register for or use the Contest Scoreboard (the “service”),
          operated by Oberon (“we”, “us”). By registering or using the service, you agree to these
          terms. If you do not agree, do not use the service.
        </p>

        <section>
          <H2>1. Eligibility and contest rules</H2>
          <p>
            You must meet the eligibility requirements and follow the rules published for the
            particular contest. Those contest-specific rules explain who may participate, the
            schedule, categories, scoring, and any awards. If they conflict with these general
            service terms, the contest-specific rules govern participation and scoring.
          </p>
        </section>

        <section>
          <H2>2. Your account</H2>
          <ul className="list-disc space-y-1 pl-5">
            <li>Provide a valid email address and accurate registration details.</li>
            <li>Keep your login key or password confidential and do not share your account.</li>
            <li>Tell us promptly if you believe someone has accessed your account without permission.</li>
            <li>Do not impersonate another participant or attempt to access another account.</li>
          </ul>
        </section>

        <section>
          <H2>3. Submissions and acceptable use</H2>
          <p>
            Submit only material that relates to your own participation and that you are entitled
            to share. Do not submit false, manipulated, unlawful, abusive, or otherwise
            rule-breaking material. Do not interfere with the service, probe or bypass its access
            controls, automate login attempts, or use it to harm others.
          </p>
        </section>

        <section>
          <H2>4. Review, scoring, and visibility</H2>
          <p>
            Submissions are reviewed under the applicable contest rules. We may reject, reverse,
            or remove a submission that does not meet those rules, and may restrict or deactivate
            accounts when reasonably necessary to protect the contest or service. Your display
            name, points, completed tasks, and rank may be shown to other signed-in participants
            on the leaderboard. Your email address and proof images are not shown on that
            leaderboard.
          </p>
        </section>

        <section>
          <H2>5. Availability and changes</H2>
          <p>
            We may update, suspend, or discontinue all or part of the service, or change contest
            details as permitted by the contest rules. We will take reasonable steps to communicate
            material changes to participants. The service may occasionally be unavailable for
            maintenance or reasons outside our control.
          </p>
        </section>

        <section>
          <H2>6. Privacy</H2>
          <p>
            Our <Link className="font-medium underline" href="/privacy">Privacy Policy</Link> explains
            how information is used to operate the service and administer the contest.
          </p>
        </section>

        <section>
          <H2>7. Liability</H2>
          <p>
            Nothing in these terms limits or excludes liability where doing so would be unlawful,
            including liability for death or personal injury caused by negligence, fraud, or your
            statutory rights. Subject to that, we are not responsible for indirect or consequential
            loss arising from use of the service. The service is provided for contest
            administration and is not guaranteed to be uninterrupted or error-free.
          </p>
        </section>

        <section>
          <H2>8. Changes and contact</H2>
          <p>
            We may revise these terms by publishing an updated version here. Contact us at{' '}
            <a className="font-medium underline" href="mailto:titanunhinged@gmail.com">
              titanunhinged@gmail.com
            </a>{' '}
            if you have a question about them.
          </p>
        </section>
      </Card>
    </Page>
  );
}
