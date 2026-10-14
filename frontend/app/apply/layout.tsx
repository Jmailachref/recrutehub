import type { ReactNode } from "react";

// Candidate pages keep their own styles (globals.css, under .legacy).
export default function Layout({ children }: { children: ReactNode }) {
  return <div className="legacy">{children}</div>;
}
