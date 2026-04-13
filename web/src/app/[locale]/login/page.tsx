"use client";

import { useState, useTransition } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, usePathname, Link } from "@/i18n/navigation";
import { routing, type Locale } from "@/i18n/routing";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/shared/button";
import { Input } from "@/components/shared/input";
import { Separator } from "@/components/shared/separator";
import { ErrorAlert } from "@/components/shared/error-alert";
import {
  Select,
  SelectTrigger,
  SelectContent,
  SelectItem,
  SelectValue,
} from "@/components/shared/select";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
  InputOTPSeparator,
} from "@/components/shared/input-otp";
import { MeditalkLogo } from "@/components/nav/meditalk-logo";
import { HugeiconsIcon } from "@hugeicons/react";
import { Loading03Icon } from "@hugeicons/core-free-icons";

const localeNames: Record<Locale, string> = {
  sk: "Slovenčina",
  cs: "Čeština",
  en: "English",
};

export default function LoginPage() {
  const t = useTranslations("login");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otpValue, setOtpValue] = useState("");
  const [verifying, setVerifying] = useState(false);

  const handleLocaleChange = (newLocale: string) => {
    startTransition(() => {
      router.replace(pathname, { locale: newLocale as Locale });
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setLoading(false);

    if (error) {
      setError(t("errorSending"));
      return;
    }

    setSent(true);
  };

  const handleVerify = async (code: string) => {
    setVerifying(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.verifyOtp({
      email,
      token: code,
      type: "email",
    });

    setVerifying(false);

    if (error) {
      setError(t("errorInvalidCode"));
      setOtpValue("");
      return;
    }

    window.location.assign("/");
  };

  const handleOtpChange = (value: string) => {
    setOtpValue(value);
    if (value.length === 6) {
      handleVerify(value);
    }
  };

  const handleResend = async () => {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    setLoading(false);

    if (error) {
      setError(t("errorSending"));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-accent px-4">
      <div className="flex w-full max-w-100 flex-col items-center gap-6 rounded-2xl border border-border bg-background p-6 desktop:p-8">
        {/* Logo */}
        <div className="flex flex-col items-center gap-3">
          <MeditalkLogo className="size-8 text-primary" />
          <span className="text-lg leading-none text-foreground">MediTalk</span>
        </div>

        {sent ? (
          /* ── Enter Code View ── */
          <>
            <div className="flex w-full flex-col items-center gap-2">
              <h1 className="text-3xl leading-none text-foreground">
                {t("enterCodeTitle")}
              </h1>
              <p className="text-center text-sm text-foreground/65">
                {t("enterCodeSubtitle")}{" "}
                <span className="font-medium text-primary">{email}</span>
              </p>
            </div>

            {error && <ErrorAlert message={error} />}

            <div className="flex w-full flex-col items-center gap-3">
              <InputOTP
                maxLength={6}
                value={otpValue}
                onChange={handleOtpChange}
                disabled={verifying}
                autoFocus
              >
                <InputOTPGroup>
                  <InputOTPSlot index={0} />
                  <InputOTPSlot index={1} />
                  <InputOTPSlot index={2} />
                </InputOTPGroup>
                <InputOTPSeparator />
                <InputOTPGroup>
                  <InputOTPSlot index={3} />
                  <InputOTPSlot index={4} />
                  <InputOTPSlot index={5} />
                </InputOTPGroup>
              </InputOTP>

              {verifying && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={20}
                  className="animate-spin text-foreground/65"
                />
              )}

              <Button
                variant="ghost"
                size="lg"
                onClick={handleResend}
                disabled={loading}
              >
                {loading ? t("resending") : t("resendCode")}
              </Button>

              <Separator />
            </div>

            <button
              type="button"
              onClick={() => {
                setSent(false);
                setOtpValue("");
                setError(null);
              }}
              className="text-sm text-foreground underline hover:opacity-70"
            >
              {t("changeEmail")}
            </button>
          </>
        ) : (
          /* ── Email Form View ── */
          <>
            <h1 className="text-3xl leading-none text-foreground">
              {t("title")}
            </h1>

            <form
              onSubmit={handleSubmit}
              className="flex w-full flex-col items-center gap-3"
            >
              {error && <ErrorAlert message={error} />}

              <Input
                type="email"
                autoFocus
                placeholder={t("emailPlaceholder")}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                required
                disabled={loading}
                className="w-full"
              />

              <Button
                type="submit"
                size="lg"
                disabled={loading || !email}
                className="w-full disabled:opacity-30"
              >
                {loading ? (
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    size={16}
                    className="animate-spin"
                  />
                ) : (
                  t("continue")
                )}
              </Button>

              <p className="text-center text-xs text-foreground/65">
                {t("terms")}{" "}
                <Link
                  href="/terms"
                  className="cursor-pointer text-foreground underline hover:opacity-70"
                >
                  {t("termsLink")}
                </Link>
              </p>
            </form>

            <Separator />

            <Select
              value={locale}
              onValueChange={handleLocaleChange}
              disabled={isPending}
            >
              <SelectTrigger className="w-full" label={t("language")}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {routing.locales.map((loc) => (
                  <SelectItem key={loc} value={loc}>
                    {localeNames[loc]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </div>
    </div>
  );
}
