"use client";

export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="final" style={{ borderTop: 0, minHeight: "100vh" }}>
      <div className="wrap">
        <span className="stamp bad">Error</span>
        <h2 style={{ marginTop: 24 }}>Something went wrong.</h2>
        <p className="muted" style={{ marginBottom: 28 }}>The page hit an unexpected error. Nothing was lost; try again.</p>
        <button onClick={reset}>Try again</button>
      </div>
    </main>
  );
}
