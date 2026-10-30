import Link from "next/link";
import { Page } from "@/ui/SiteChrome";

export default function NotFound() {
  return (
    <Page>
      <section className="final" style={{ borderTop: 0 }}>
        <div className="wrap">
          <span className="stamp bad">404</span>
          <h2 style={{ marginTop: 24 }}>That page was not found.</h2>
          <p className="muted" style={{ marginBottom: 28 }}>The link may be old, or the page may have moved.</p>
          <div className="cta" style={{ justifyContent: "center" }}>
            <Link className="btn lg" href="/">Back to the site</Link>
            <Link className="btn lg ghost" href="/dashboard">Open the dashboard</Link>
          </div>
        </div>
      </section>
    </Page>
  );
}
