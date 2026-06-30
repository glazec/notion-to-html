import { ArrowRight, ExternalLink, FileText, RefreshCw, Search } from "lucide-react";
import type { PageRecord } from "@/lib/db";
import { listRecentPages } from "@/lib/page-store";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const pages = await getRecentPages();

  return (
    <main className="landing-shell">
      <header className="topbar">
        <a className="brand" href="/">
          <span className="brand-mark">N</span>
          <span>Notion to HTML</span>
        </a>
        <nav className="topnav" aria-label="Primary">
          <a href="#pages">Pages</a>
          <a href="https://www.firecrawl.dev" target="_blank" rel="noreferrer">Firecrawl</a>
          <a href="/api/inngest" target="_blank" rel="noreferrer">Inngest</a>
        </nav>
      </header>

      <section className="hero-search">
        <div className="hero-copy">
          <h1>Turn public Notion pages into clean HTML.</h1>
          <p>Paste a public Notion URL. We crawl it, generate an HTML version, cache it, and keep a regenerate control on the page.</p>
          <form action="/api/pages" method="post">
            <div className="search-row">
              <Search size={18} />
              <input
                className="url-input"
                name="notionUrl"
                type="url"
                placeholder="https://app.notion.com/p/workspace/Page-title-..."
                required
              />
              <button className="button" type="submit" aria-label="Generate HTML">
                Generate
                <ArrowRight size={16} />
              </button>
            </div>
          </form>
          <div className="proof-row">
            <span>Public pages only</span>
            <span>Images preserved</span>
            <span>Cached HTML</span>
          </div>
        </div>
      </section>

      <section className="main" id="pages">
        <div className="panel table-panel">
          <div className="create-panel">
            <h2>Recent pages</h2>
          </div>
          {pages.length > 0 ? (
              <table className="page-table">
                <thead>
                  <tr>
                    <th>Page</th>
                    <th>Status</th>
                    <th>Updated</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {pages.map((page) => (
                    <tr key={page.page_key}>
                      <td>
                        <a href={`/${page.slug}`}>{page.slug}</a>
                      </td>
                      <td>
                        <span className={`status ${page.status}`}>{page.status}</span>
                      </td>
                      <td className="muted">{formatDate(page.updated_at)}</td>
                      <td>
                        <a className="icon-button" href={`/p/${page.page_key}`} aria-label="Open page">
                          <ExternalLink size={17} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="empty">
                No pages yet. Add a Notion link to create the first cached HTML
                version.
              </div>
            )}
        </div>

        <div className="floating-toolbar-demo" aria-label="Generated page toolbar preview">
          <span className="icon-button">
            <ExternalLink size={17} />
          </span>
          <span className="icon-button">
            <RefreshCw size={17} />
          </span>
        </div>
      </section>
    </main>
  );
}

async function getRecentPages(): Promise<PageRecord[]> {
  try {
    return await listRecentPages();
  } catch {
    return [];
  }
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}
