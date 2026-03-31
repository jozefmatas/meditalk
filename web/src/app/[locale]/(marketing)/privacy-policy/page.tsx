import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function PrivacyPolicyPage() {
  const t = useTranslations("marketing.privacyPolicy");

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <div className="space-y-12">
        {/* Header */}
        <div className="space-y-4 border-b border-border pb-8">
          <h1 className="text-4xl font-bold tracking-tight">{t("title")}</h1>
          <div className="space-y-2 text-sm text-muted-foreground">
            <p>{t("effectiveDate")}</p>
            <p>{t("lastModified")}</p>
          </div>
        </div>

        {/* Introduction */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">1. {t("s1.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s1.p1")}</p>
          <p className="leading-relaxed text-foreground/90">{t("s1.p2")}</p>
        </section>

        {/* Data Controller */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">2. {t("s2.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s2.p1")}</p>
          <div className="rounded-lg border border-border bg-muted/30 p-6 space-y-2 text-sm">
            <p className="font-medium">{t("s2.company")}</p>
            <p>{t("s2.address")}</p>
            <p>{t("s2.email")}</p>
          </div>
        </section>

        {/* What Data We Collect */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">3. {t("s3.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s3.intro")}</p>

          <div className="space-y-6">
            <div>
              <h3 className="text-lg font-medium mb-2">
                3.1 {t("s3.s1.title")}
              </h3>
              <ul className="list-disc pl-6 space-y-1 text-foreground/90">
                <li>{t("s3.s1.i1")}</li>
                <li>{t("s3.s1.i2")}</li>
                <li>{t("s3.s1.i3")}</li>
                <li>{t("s3.s1.i4")}</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">
                3.2 {t("s3.s2.title")}
              </h3>
              <ul className="list-disc pl-6 space-y-1 text-foreground/90">
                <li>{t("s3.s2.i1")}</li>
                <li>{t("s3.s2.i2")}</li>
                <li>{t("s3.s2.i3")}</li>
                <li>{t("s3.s2.i4")}</li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">
                3.3 {t("s3.s3.title")}
              </h3>
              <ul className="list-disc pl-6 space-y-1 text-foreground/90">
                <li>{t("s3.s3.i1")}</li>
                <li>{t("s3.s3.i2")}</li>
                <li>{t("s3.s3.i3")}</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Legal Basis */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">4. {t("s4.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s4.intro")}</p>
          <ul className="list-disc pl-6 space-y-2 text-foreground/90">
            <li>
              <strong>{t("s4.i1.title")}</strong> {t("s4.i1.desc")}
            </li>
            <li>
              <strong>{t("s4.i2.title")}</strong> {t("s4.i2.desc")}
            </li>
            <li>
              <strong>{t("s4.i3.title")}</strong> {t("s4.i3.desc")}
            </li>
          </ul>
        </section>

        {/* How We Use Data */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">5. {t("s5.title")}</h2>
          <ul className="list-disc pl-6 space-y-1 text-foreground/90">
            <li>{t("s5.i1")}</li>
            <li>{t("s5.i2")}</li>
            <li>{t("s5.i3")}</li>
            <li>{t("s5.i4")}</li>
            <li>{t("s5.i5")}</li>
          </ul>
        </section>

        {/* AI Processing */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">6. {t("s6.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s6.p1")}</p>
          <div className="space-y-3">
            <div>
              <p className="font-medium">{t("s6.anthropic.title")}</p>
              <p className="text-sm text-foreground/80">
                {t("s6.anthropic.desc")}
              </p>
            </div>
            <div>
              <p className="font-medium">{t("s6.openai.title")}</p>
              <p className="text-sm text-foreground/80">
                {t("s6.openai.desc")}
              </p>
            </div>
          </div>
          <p className="leading-relaxed text-foreground/90">{t("s6.p2")}</p>
        </section>

        {/* Data Sharing */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">7. {t("s7.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s7.p1")}</p>
          <ul className="list-disc pl-6 space-y-1 text-foreground/90">
            <li>{t("s7.i1")}</li>
            <li>{t("s7.i2")}</li>
            <li>{t("s7.i3")}</li>
          </ul>
        </section>

        {/* Data Retention */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">8. {t("s8.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s8.p1")}</p>
          <p className="leading-relaxed text-foreground/90">{t("s8.p2")}</p>
        </section>

        {/* Security */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">9. {t("s9.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s9.p1")}</p>
          <ul className="list-disc pl-6 space-y-1 text-foreground/90">
            <li>{t("s9.i1")}</li>
            <li>{t("s9.i2")}</li>
            <li>{t("s9.i3")}</li>
            <li>{t("s9.i4")}</li>
          </ul>
        </section>

        {/* Your Rights */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">10. {t("s10.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s10.intro")}</p>
          <ul className="list-disc pl-6 space-y-2 text-foreground/90">
            <li>
              <strong>{t("s10.i1.title")}</strong> {t("s10.i1.desc")}
            </li>
            <li>
              <strong>{t("s10.i2.title")}</strong> {t("s10.i2.desc")}
            </li>
            <li>
              <strong>{t("s10.i3.title")}</strong> {t("s10.i3.desc")}
            </li>
            <li>
              <strong>{t("s10.i4.title")}</strong> {t("s10.i4.desc")}
            </li>
            <li>
              <strong>{t("s10.i5.title")}</strong> {t("s10.i5.desc")}
            </li>
            <li>
              <strong>{t("s10.i6.title")}</strong> {t("s10.i6.desc")}
            </li>
          </ul>
          <p className="leading-relaxed text-foreground/90">
            {t("s10.exercise")}
          </p>
        </section>

        {/* International Transfers */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">11. {t("s11.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s11.p1")}</p>
          <p className="leading-relaxed text-foreground/90">{t("s11.p2")}</p>
        </section>

        {/* Cookies */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">12. {t("s12.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s12.p1")}</p>
        </section>

        {/* Changes */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">13. {t("s13.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s13.p1")}</p>
        </section>

        {/* Contact */}
        <section className="space-y-4 border-t border-border pt-8">
          <h2 className="text-2xl font-semibold">14. {t("s14.title")}</h2>
          <div className="space-y-3 text-foreground/90">
            <p>{t("s14.p1")}</p>
            <div className="rounded-lg border border-border bg-muted/30 p-6 space-y-2 text-sm">
              <p>
                <strong>{t("s14.emailLabel")}</strong> {t("s14.email")}
              </p>
              <p>
                <strong>{t("s14.addressLabel")}</strong> {t("s14.address")}
              </p>
            </div>
            <p className="text-sm">{t("s14.supervisory")}</p>
          </div>
        </section>

        {/* Footer note */}
        <div className="border-t border-border pt-6 text-center">
          <p className="text-sm text-muted-foreground">
            {t("footer")}{" "}
            <Link
              href="/terms-of-service"
              className="underline hover:text-foreground"
            >
              {t("footerLink")}
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
