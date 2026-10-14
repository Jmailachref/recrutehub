"use client";

import { useParams } from "next/navigation";
import OfferEditor from "@/components/OfferEditor";
import { useUser } from "../../../AppShell";

export default function EditOfferPage() {
  const { id } = useParams<{ id: string }>();
  const user = useUser();
  if (user?.role === "editor") return <p className="text-gray-500">Editors can read offers but not change them.</p>;
  return <OfferEditor offerId={id} />;
}
