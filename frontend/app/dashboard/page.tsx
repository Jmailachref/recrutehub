"use client";

import { useUser } from "../AppShell";

const NEXT_UP = [
  { title: "Offers", text: "Create a job offer and choose its test: topics, levels, code and QCM questions." },
  { title: "Candidates", text: "Applications with their CVs, test status and score." },
  { title: "Questions", text: "The question bank in Code Playground, AI generation and approval." },
];

export default function Dashboard() {
  const user = useUser();
  return (
    <>
      <h1>Welcome{user?.full_name ? `, ${user.full_name}` : ""}</h1>
      <p className="muted">You are signed in to {user?.tenant_name}. These sections arrive in the next steps.</p>
      <div className="grid">
        {NEXT_UP.map((item) => (
          <section key={item.title} className="card">
            <h2>{item.title}</h2>
            <p className="muted">{item.text}</p>
          </section>
        ))}
      </div>
    </>
  );
}
