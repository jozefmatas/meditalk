"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

function AuthConfirmContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [status, setStatus] = useState<"idle" | "verifying" | "error">("idle");

  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as
    | "magiclink"
    | "email"
    | "signup"
    | null;

  async function handleConfirm() {
    if (!tokenHash || !type) {
      setStatus("error");
      return;
    }

    setStatus("verifying");

    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      token_hash: tokenHash,
      type,
    });

    if (error) {
      setStatus("error");
      return;
    }

    // Redirect to app after successful verification
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    router.push(appUrl || "/");
  }

  // Auto-verify on page load (user clicked the link intentionally)
  useEffect(() => {
    if (tokenHash && type) {
      handleConfirm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (status === "error") {
    return (
      <div
        style={{
          maxWidth: 480,
          margin: "0 auto",
          padding: "80px 24px",
          textAlign: "center",
          fontFamily:
            "'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        }}
      >
        <h2
          style={{
            fontSize: 22,
            fontWeight: 600,
            color: "#232334",
            marginBottom: 8,
          }}
        >
          Link expired
        </h2>
        <p
          style={{
            fontSize: 15,
            color: "#232334",
            opacity: 0.65,
            marginBottom: 32,
          }}
        >
          This magic link has already been used or has expired.
        </p>
        <a
          href="/login"
          style={{
            display: "inline-block",
            backgroundColor: "#4444ff",
            color: "#fff",
            fontSize: 15,
            textDecoration: "none",
            padding: "12px 32px",
            borderRadius: 10,
          }}
        >
          Back to login
        </a>
      </div>
    );
  }

  return (
    <div
      style={{
        maxWidth: 480,
        margin: "0 auto",
        padding: "80px 24px",
        textAlign: "center",
        fontFamily:
          "'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      }}
    >
      <h2
        style={{
          fontSize: 22,
          fontWeight: 600,
          color: "#232334",
          marginBottom: 8,
        }}
      >
        {status === "verifying" ? "Signing you in..." : "Confirm your login"}
      </h2>
      <p
        style={{
          fontSize: 15,
          color: "#232334",
          opacity: 0.65,
          marginBottom: 32,
        }}
      >
        {status === "verifying"
          ? "Please wait a moment."
          : "Click the button below to complete sign in."}
      </p>
      {status === "idle" && (
        <button
          onClick={handleConfirm}
          style={{
            display: "inline-block",
            backgroundColor: "#4444ff",
            color: "#fff",
            fontSize: 15,
            border: "none",
            cursor: "pointer",
            padding: "12px 32px",
            borderRadius: 10,
          }}
        >
          Log in to MediTalk
        </button>
      )}
    </div>
  );
}

export default function AuthConfirmPage() {
  return (
    <Suspense
      fallback={
        <div
          style={{
            maxWidth: 480,
            margin: "0 auto",
            padding: "80px 24px",
            textAlign: "center",
            fontFamily:
              "'Figtree', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          }}
        >
          <h2
            style={{
              fontSize: 22,
              fontWeight: 600,
              color: "#232334",
              marginBottom: 8,
            }}
          >
            Signing you in...
          </h2>
          <p style={{ fontSize: 15, color: "#232334", opacity: 0.65 }}>
            Please wait a moment.
          </p>
        </div>
      }
    >
      <AuthConfirmContent />
    </Suspense>
  );
}
