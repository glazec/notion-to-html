import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms | Notion to HTML",
  description: "Terms for using the Notion to HTML publishing service.",
};

export default function TermsPage() {
  return (
    <main className="legal-page">
      <header className="legal-header">
        <a className="brand" href="/" aria-label="Notion to HTML home">
          <span className="brand-mark" aria-hidden="true">N</span>
          <span>Notion to HTML</span>
        </a>
      </header>
      <article className="legal-content">
        <h1>Terms</h1>
        <p className="legal-updated">Effective August 1, 2026</p>

        <section>
          <h2>Using the service</h2>
          <p>Notion to HTML converts public Notion pages into public websites. You must have permission to access, process, and publish every page and asset you submit.</p>
        </section>

        <section>
          <h2>Account limits</h2>
          <p>Standard Google accounts may create two websites per UTC day. Verified IOSG accounts have unlimited creation. We may adjust limits or restrict automated and abusive usage to protect the service.</p>
        </section>

        <section>
          <h2>Acceptable content</h2>
          <p>Do not use the service to publish unlawful, deceptive, infringing, malicious, or private material. We may disable content or accounts that create security, legal, or operational risk.</p>
        </section>

        <section>
          <h2>Availability</h2>
          <p>The service is provided on a best effort basis. Generated output may be incomplete when a source changes, becomes unavailable, or contains unsupported content. Features and limits may change as the service develops.</p>
        </section>

        <section>
          <h2>Contact</h2>
          <p>Questions about these terms may be sent to <a href="mailto:yiping@iosg.vc">yiping@iosg.vc</a>.</p>
        </section>
      </article>
    </main>
  );
}
