"use client";

import { useEffect, useState } from "react";

const SERVICES = ["auth", "offers", "questions", "candidates", "assessments", "notifications"];

type Status = "checking" | "ok" | "down";

export default function Home() {
  const [status, setStatus] = useState<Record<string, Status>>(
    Object.fromEntries(SERVICES.map((s) => [s, "checking"])),
  );

  useEffect(() => {
    for (const service of SERVICES) {
      fetch(`/api/${service}/health`)
        .then((r) => (r.ok ? "ok" : "down"))
        .catch(() => "down" as const)
        .then((s) => setStatus((prev) => ({ ...prev, [service]: s })));
    }
  }, []);

  return (
    <main>
      <h1>RecruteHub</h1>
      <p>The stack is up. Sign in and the recruiter dashboard come next.</p>
      <ul>
        {SERVICES.map((service) => (
          <li key={service}>
            <span>{service}</span>
            <span className={status[service] === "ok" ? "ok" : status[service] === "down" ? "bad" : ""}>
              {status[service]}
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
