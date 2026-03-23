"use client";

import { useState } from "react";

export function VisibilityToggle({
  templateId,
  initialVisible,
}: {
  templateId: string;
  initialVisible: boolean;
}) {
  const [visible, setVisible] = useState(initialVisible);
  const [loading, setLoading] = useState(false);

  async function toggle() {
    setLoading(true);
    const next = !visible;
    try {
      const res = await fetch(`/api/templates/${templateId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visible: next }),
      });
      if (res.ok) setVisible(next);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      type="button"
      role="switch"
      aria-checked={visible}
      disabled={loading}
      onClick={toggle}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:cursor-wait disabled:opacity-50 ${
        visible ? "bg-green-600" : "bg-muted"
      }`}
    >
      <span
        className={`pointer-events-none block size-4 rounded-full bg-white shadow-sm transition-transform ${
          visible ? "translate-x-4.5" : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
