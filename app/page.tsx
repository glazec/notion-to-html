import { ArrowRight, ExternalLink } from "lucide-react";
import type { PageRecord } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/server";
import { AuthButton } from "@/app/auth-button";
import { getUserSiteQuota, listUserSites, type SiteQuota } from "@/lib/site-credits";
import { optionalEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string }>;
}) {
  const { notice } = await searchParams;
  const user = await getLandingUser();
  const { pages, quota } = user
    ? await getAccountData(user.id, user.email)
    : { pages: [], quota: null };

  return (
    <main className="landing-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Notion to HTML home">
          <span className="brand-mark" aria-hidden="true">N</span>
          <span>Notion to HTML</span>
        </a>
        <nav className="topnav" aria-label="Primary navigation">
          <a href="#process">Process</a>
          <a href="#roadmap">Roadmap</a>
          <AuthButton userEmail={user?.email ?? null} />
        </nav>
      </header>

      <section className="hero-search">
        <div className="hero-copy">
          <p className="eyebrow">PUBLIC NOTION PUBLISHER · EARLY ACCESS</p>
          <h1>Your thinking,<br /><em>ready for the web.</em></h1>
          <p className="hero-lede">
            Turn a public Notion page into a carefully typeset website. Images,
            source links, tables, and diagrams stay connected to the original.
          </p>

          {notice === "sign-in-required" && (
            <p className="notice" role="status">Sign in with Google before creating a site.</p>
          )}

          {user ? (
            <form action="/api/pages" method="post" className="create-form">
              <label htmlFor="notion-url">Public Notion URL</label>
              <div className="search-row">
                <input
                  id="notion-url"
                  className="url-input"
                  name="notionUrl"
                  type="url"
                  placeholder="https://notion.so/your-page"
                  required
                />
                <button className="button" type="submit">
                  Create site
                  <ArrowRight size={16} aria-hidden="true" />
                </button>
              </div>
              <p className="quota-copy">{quotaLabel(quota)}</p>
            </form>
          ) : (
            <div className="sign-in-gate">
              <AuthButton userEmail={null} prominent />
              <p>Google sign in includes two free sites every UTC day.</p>
            </div>
          )}

          <div className="proof-row" aria-label="Available features">
            <span>Public pages</span>
            <span>Source images</span>
            <span>Kami inspired diagrams</span>
            <span>Fast cached HTML</span>
          </div>
        </div>
      </section>

      <section className="process-section" id="process">
        <div className="section-heading">
          <p className="eyebrow">01 · PROCESS</p>
          <h2>One clear path from note to site.</h2>
          <p>Structure is preserved first. Presentation comes second.</p>
        </div>
        <div className="process-diagram" role="img" aria-label="Notion content flows through source capture, document shaping, account limits, and public HTML publishing">
          <ProcessNode index="01" label="SOURCE" title="Notion" detail="Text · media · links" />
          <ProcessNode index="02" label="SHAPE" title="Codex" detail="Hierarchy · diagrams" focal />
          <ProcessNode index="03" label="GUARD" title="Neon" detail="Identity · daily quota" />
          <ProcessNode index="04" label="PUBLISH" title="HTML" detail="Cached · shareable" />
        </div>
        <p className="diagram-caption">A generated page carries the source’s identity, never ours.</p>
      </section>

      <section className="roadmap-section" id="roadmap">
        <div className="section-heading">
          <p className="eyebrow">02 · ROADMAP</p>
          <h2>Publishing is live. The workflow gets quieter next.</h2>
        </div>
        <div className="feature-grid">
          <Feature status="LIVE" title="Generate and publish" body="Create a permanent public page from a public Notion URL." />
          <Feature status="COMING" title="Automatic updates" body="Republish when the source changes, without a manual refresh." />
          <Feature status="COMING" title="Pre generation" body="Prepare the next version before readers request it." />
          <Feature status="COMING" title="Custom themes" body="Choose typography, color, density, and diagram treatment." />
        </div>
      </section>

      {user && (
        <section className="sites-section" id="sites">
          <div className="section-heading compact">
            <p className="eyebrow">03 · YOUR SITES</p>
            <h2>Published from this account.</h2>
          </div>
          {pages.length > 0 ? (
            <div className="site-list">
              {pages.map((page, index) => (
                <a className="site-row" href={`/${page.slug}`} key={page.page_key}>
                  <span className="site-index">{String(index + 1).padStart(2, "0")}</span>
                  <span className="site-title">{page.slug}</span>
                  <span className={`status ${page.status}`}>{page.status}</span>
                  <span className="site-date">{formatDate(page.updated_at)}</span>
                  <ExternalLink size={16} aria-hidden="true" />
                </a>
              ))}
            </div>
          ) : (
            <div className="empty">Your first published page will appear here.</div>
          )}
        </section>
      )}

      <footer className="footer">
        <span>Notion to HTML</span>
        <span>Made for durable, readable publishing.</span>
      </footer>
    </main>
  );
}

function ProcessNode({
  index,
  label,
  title,
  detail,
  focal = false,
}: {
  index: string;
  label: string;
  title: string;
  detail: string;
  focal?: boolean;
}) {
  return (
    <div className={`process-node${focal ? " focal" : ""}`}>
      <span className="node-index">{index}</span>
      <span className="node-label">{label}</span>
      <strong>{title}</strong>
      <small>{detail}</small>
    </div>
  );
}

function Feature({ status, title, body }: { status: "LIVE" | "COMING"; title: string; body: string }) {
  return (
    <article className="feature-card">
      <span className={`feature-status ${status === "LIVE" ? "live" : ""}`}>{status === "LIVE" ? "AVAILABLE" : "COMING SOON"}</span>
      <h3>{title}</h3>
      <p>{body}</p>
    </article>
  );
}

async function getAccountData(userId: string, email: string): Promise<{ pages: PageRecord[]; quota: SiteQuota }> {
  const [pages, quota] = await Promise.all([
    listUserSites(userId),
    getUserSiteQuota(userId, email),
  ]);
  return { pages, quota };
}

async function getLandingUser() {
  if (!optionalEnv("NEON_AUTH_BASE_URL") || !optionalEnv("NEON_AUTH_COOKIE_SECRET")) {
    return null;
  }

  try {
    return await getCurrentUser();
  } catch (error) {
    console.error("Unable to read the current auth session", error);
    return null;
  }
}

function quotaLabel(quota: SiteQuota | null): string {
  if (!quota) return "";
  if (quota.unlimited) return "Unlimited site creation for verified IOSG accounts.";
  return `${quota.remaining} of ${quota.limit} free site credits remaining today. Resets at 00:00 UTC.`;
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(value);
}
