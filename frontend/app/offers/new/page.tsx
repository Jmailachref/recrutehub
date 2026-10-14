"use client";

import OfferEditor from "@/components/OfferEditor";
import { useUser } from "../../AppShell";

export default function NewOfferPage() {
  const user = useUser();
  if (user?.role === "editor") return <p className="text-gray-500">Editors can read offers but not create them.</p>;
  return <OfferEditor />;
}
