import { redirect } from "next/navigation";

// Candidates are listed on their offer's page; old links land there.
export default async function CandidatesPage({ searchParams }: { searchParams: Promise<{ offer?: string }> }) {
  const { offer } = await searchParams;
  redirect(offer ? `/offers/${encodeURIComponent(offer)}` : "/dashboard");
}
