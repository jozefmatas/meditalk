"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/shared/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/shared/card";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/shared/input-group";
import { Alert, AlertDescription } from "@/components/shared/alert";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Mail01Icon,
  Loading03Icon,
  AlertCircleIcon,
  ArrowLeft01Icon,
} from "@hugeicons/core-free-icons";

export default function LoginPage() {
  const t = useTranslations("login");
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [otp, setOtp] = useState(["", "", "", "", "", ""]);
  const [verifying, setVerifying] = useState(false);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
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
      setOtp(["", "", "", "", "", ""]);
      inputRefs.current[0]?.focus();
      return;
    }

    // Full page navigation ensures auth cookies are sent on the server round-trip
    // (router.push does a soft navigation that can fail on mobile Safari)
    window.location.assign("/");
  };

  const handleOtpChange = (index: number, value: string) => {
    // Only allow digits
    const digit = value.replace(/\D/g, "").slice(-1);
    const newOtp = [...otp];
    newOtp[index] = digit;
    setOtp(newOtp);

    // Auto-advance to next input
    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits are filled
    const code = newOtp.join("");
    if (code.length === 6 && newOtp.every((d) => d !== "")) {
      handleVerify(code);
    }
  };

  const handleOtpKeyDown = (
    index: number,
    e: React.KeyboardEvent<HTMLInputElement>,
  ) => {
    if (e.key === "Backspace" && !otp[index] && index > 0) {
      inputRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData
      .getData("text")
      .replace(/\D/g, "")
      .slice(0, 6);
    if (!pasted) return;

    const newOtp = ["", "", "", "", "", ""];
    for (let i = 0; i < pasted.length; i++) {
      newOtp[i] = pasted[i];
    }
    setOtp(newOtp);

    // Focus appropriate input
    if (pasted.length >= 6) {
      inputRefs.current[5]?.focus();
      handleVerify(pasted.slice(0, 6));
    } else {
      inputRefs.current[pasted.length]?.focus();
    }
  };

  const handleResend = async () => {
    setLoading(true);
    setError(null);

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
    });

    setLoading(false);

    if (error) {
      setError(t("errorSending"));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">MediTalk</CardTitle>
          <CardDescription>
            {sent ? t("enterCode", { email }) : t("description")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="flex flex-col items-center gap-6 py-4">
              {error && (
                <Alert variant="destructive">
                  <HugeiconsIcon icon={AlertCircleIcon} size={16} />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <div className="flex gap-2" onPaste={handleOtpPaste}>
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    ref={(el) => {
                      inputRefs.current[i] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(i, e.target.value)}
                    onKeyDown={(e) => handleOtpKeyDown(i, e)}
                    disabled={verifying}
                    className="h-12 w-10 rounded-lg border border-input bg-background text-center text-lg font-semibold focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50"
                  />
                ))}
              </div>

              {verifying && (
                <HugeiconsIcon
                  icon={Loading03Icon}
                  size={24}
                  className="animate-spin text-muted-foreground"
                />
              )}

              <div className="flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={loading}
                  className="text-sm text-muted-foreground underline hover:text-foreground disabled:opacity-50"
                >
                  {loading ? t("resending") : t("resendCode")}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSent(false);
                    setOtp(["", "", "", "", "", ""]);
                    setError(null);
                  }}
                  className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
                >
                  <HugeiconsIcon icon={ArrowLeft01Icon} size={14} />
                  {t("changeEmail")}
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              {error && (
                <Alert variant="destructive">
                  <HugeiconsIcon icon={AlertCircleIcon} size={16} />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="flex flex-col gap-2">
                <label htmlFor="email" className="text-sm font-medium">
                  {t("emailLabel")}
                </label>
                <InputGroup>
                  <InputGroupAddon>
                    <HugeiconsIcon icon={Mail01Icon} />
                  </InputGroupAddon>
                  <InputGroupInput
                    id="email"
                    type="email"
                    placeholder={t("emailPlaceholder")}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={loading}
                  />
                </InputGroup>
              </div>
              <Button
                type="submit"
                disabled={loading || !email}
                className="w-full"
              >
                {loading ? (
                  <HugeiconsIcon
                    icon={Loading03Icon}
                    size={20}
                    className="animate-spin"
                  />
                ) : (
                  t("sendCode")
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
