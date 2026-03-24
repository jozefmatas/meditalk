"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/shared/button";
import { ErrorAlert } from "@/components/shared/error-alert";
import { MeditalkLogo } from "@/components/nav/meditalk-logo";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";

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

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "";
    router.push(appUrl || "/");
  }

  useEffect(() => {
    if (tokenHash && type) {
      handleConfirm();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-accent px-4">
      <div className="flex w-full max-w-100 flex-col items-center gap-6 rounded-2xl border border-border bg-background p-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <MeditalkLogo className="size-8 text-primary" />
          <span className="text-lg text-foreground">MediTalk</span>
        </div>

        {status === "error" ? (
          <>
            <ErrorAlert message="This magic link has already been used or has expired." />
            <Button asChild className="w-full">
              <Link href="/login">Back to login</Link>
            </Button>
          </>
        ) : (
          <>
            <div className="flex flex-col items-center gap-2">
              <h1 className="text-3xl leading-none text-foreground">
                {status === "verifying"
                  ? "Signing you in..."
                  : "Confirm your login"}
              </h1>
              <p className="text-center text-sm text-foreground/65">
                {status === "verifying"
                  ? "Please wait a moment."
                  : "Click the button below to complete sign in."}
              </p>
            </div>

            {status === "verifying" ? (
              <HugeiconsIcon
                icon={Loading03Icon}
                size={24}
                className="animate-spin text-foreground/65"
              />
            ) : (
              <Button onClick={handleConfirm} className="w-full">
                Log in to MediTalk
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function AuthConfirmPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-accent px-4">
          <div className="flex w-full max-w-100 flex-col items-center gap-6 rounded-2xl border border-border bg-background p-8">
            <div className="flex flex-col items-center gap-3">
              <MeditalkLogo className="size-8 text-primary" />
              <span className="text-lg text-foreground">MediTalk</span>
            </div>
            <h1 className="text-2xl text-foreground">Signing you in...</h1>
            <HugeiconsIcon
              icon={Loading03Icon}
              size={24}
              className="animate-spin text-foreground/65"
            />
          </div>
        </div>
      }
    >
      <AuthConfirmContent />
    </Suspense>
  );
}
