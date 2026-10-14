import { redirect } from "next/navigation";

// Offers are listed on the dashboard.
export default function OffersPage() {
  redirect("/dashboard");
}
