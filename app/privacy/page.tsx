import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy | Notion to HTML",
  description: "How Notion to HTML handles account and publishing data.",
};

export default function PrivacyPage() {
  return (
    <main className="legal-page">
      <header className="legal-header">
        <a className="brand" href="/" aria-label="Notion to HTML home">
          <span className="brand-mark" aria-hidden="true">N</span>
          <span>Notion to HTML</span>
        </a>
      </header>
      <article className="legal-content">
        <h1>Privacy</h1>
        <p className="legal-updated">Effective August 1, 2026</p>

        <section>
          <h2>Information we process</h2>
          <ul>
            <li>Google account identifiers, name, email address, and authentication session data.</li>
            <li>Public Notion URLs you submit and the source content needed to generate a website.</li>
            <li>Publishing status, daily site credit usage, and operational logs used to run and protect the service.</li>
          </ul>
        </section>

        <section>
          <h2>How information is used</h2>
          <p>We use this information to authenticate accounts, enforce site limits, generate and host public pages, preserve requested assets, troubleshoot failures, and prevent abuse. We do not sell personal information.</p>
        </section>

        <section>
          <h2>Public publishing</h2>
          <p>Websites created through this service are public. Submit only Notion pages and assets you are permitted to publish. Removing sharing access from the source does not automatically remove an already generated website.</p>
        </section>

        <section>
          <h2>Service providers and retention</h2>
          <p>We use infrastructure, authentication, database, content processing, and hosting providers to operate the service. Data is retained while needed to provide the service, maintain security, or meet legal obligations.</p>
        </section>

        <section>
          <h2>Your choices</h2>
          <p>You may sign out at any time. To request access, correction, or deletion of account or published data, contact <a href="mailto:yiping@iosg.vc">yiping@iosg.vc</a>.</p>
        </section>
      </article>
    </main>
  );
}
