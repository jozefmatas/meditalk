"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";

export function NewTemplateButton() {
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch("/api/templates", { method: "POST" });
      if (res.ok) {
        const { id } = await res.json();
        router.push(`/templates/${id}`);
      }
    } finally {
      setCreating(false);
    }
  }

  return (
    <Button size="sm" onClick={handleCreate} disabled={creating}>
      {creating ? <Loader2 className="animate-spin" /> : <Plus />}
      New template
    </Button>
  );
}
