"use client";

// Old links to a test open the candidate's page, which shows the test.
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api, TestDetail } from "@/lib/api";

export default function TestRedirect() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    api<TestDetail>(`/api/assessments/sessions/${id}`)
      .then((t) => router.replace(`/offers/${t.offer_id}/candidates/${t.candidate_id}`))
      .catch(() => setError("Test not found"));
  }, [id, router]);

  return <p className={error ? "text-red-600" : "text-gray-500"}>{error || "Loading…"}</p>;
}
