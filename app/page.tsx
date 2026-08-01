import { ArrowRight, ExternalLink, Search } from "lucide-react";
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
          <a href="#features">Features</a>
          {user && <a href="#sites">Your sites</a>}
          <AuthButton userEmail={user?.email ?? null} />
        </nav>
      </header>

      <section className="hero-search">
        <div className="hero-copy">
          <h1>Turn public Notion pages into clean HTML.</h1>
          <p className="hero-lede">
            Notion to HTML turns public Notion pages into clean, shareable websites.
            Paste a public Notion URL to preserve its content and images in fast cached HTML.
          </p>

          {notice === "sign-in-required" && (
            <p className="notice" role="status">Sign in with Google before creating a site.</p>
          )}

          {user ? (
            <form action="/api/pages" method="post" className="create-form">
              <div className="search-row">
                <Search size={18} aria-hidden="true" />
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
            <span>Public pages only</span>
            <span>Images preserved</span>
            <span>Cached HTML</span>
          </div>
        </div>
      </section>

      <section className="landing-main" id="features">
        <div className="section-heading">
          <div>
            <p className="section-label">Features</p>
            <h2>Simple publishing now. More control next.</h2>
          </div>
          <p>Generated Notion pages use a clean editorial theme. More publishing controls are on the way.</p>
        </div>
        <div className="feature-grid">
          <Feature status="LIVE" title="Generate and publish" body="Create a permanent public page from a public Notion URL." />
          <Feature status="COMING" title="Automatic updates" body="Republish when the source changes without a manual refresh." />
          <Feature status="COMING" title="Pre generation" body="Prepare the next version before readers request it." />
          <Feature status="COMING" title="Custom themes" body="Choose typography, color, density, and diagram treatment." />
        </div>
      </section>

      {user && (
        <section className="sites-section" id="sites">
          <div className="panel-heading">
            <div>
              <p className="section-label">Your sites</p>
              <h2>Published from this account</h2>
            </div>
            <span>{pages.length} total</span>
          </div>
          {pages.length > 0 ? (
            <div className="site-table-wrap">
              <table className="page-table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((page) => (
                    <tr key={page.page_key}>
                      <td><a className="site-title" href={`/${page.slug}`}>{page.slug}</a></td>
                      <td><span className={`status ${page.status}`}>{page.status}</span></td>
                      <td className="muted">{formatDate(page.updated_at)}</td>
                      <td>
                        <a className="icon-button" href={`/${page.slug}`} aria-label={`Open ${page.slug}`}>
                          <ExternalLink size={16} aria-hidden="true" />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty">Your first published page will appear here.</div>
          )}
        </section>
      )}

      <footer className="footer">
        <span>Notion to HTML</span>
        <div className="footer-links">
          <span>Two free sites every day. Unlimited for IOSG accounts.</span>
          <a href="/privacy">Privacy</a>
          <a href="/terms">Terms</a>
        </div>
      </footer>
    </main>
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
