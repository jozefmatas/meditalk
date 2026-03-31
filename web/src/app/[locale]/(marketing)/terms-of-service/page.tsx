import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

export default function TermsOfServicePage() {
  const t = useTranslations("marketing.termsOfService");

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

        {/* Definitions */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">2. {t("s2.title")}</h2>
          <ul className="list-disc pl-6 space-y-2 text-foreground/90">
            <li>
              <strong>&ldquo;{t("s2.i1.term")}&rdquo;</strong> {t("s2.i1.def")}
            </li>
            <li>
              <strong>&ldquo;{t("s2.i2.term")}&rdquo;</strong> {t("s2.i2.def")}
            </li>
            <li>
              <strong>&ldquo;{t("s2.i3.term")}&rdquo;</strong> {t("s2.i3.def")}
            </li>
            <li>
              <strong>&ldquo;{t("s2.i4.term")}&rdquo;</strong> {t("s2.i4.def")}
            </li>
            <li>
              <strong>&ldquo;{t("s2.i5.term")}&rdquo;</strong> {t("s2.i5.def")}
            </li>
          </ul>
        </section>

        {/* Eligibility */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">3. {t("s3.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s3.p1")}</p>
          <ul className="list-disc pl-6 space-y-1 text-foreground/90">
            <li>{t("s3.i1")}</li>
            <li>{t("s3.i2")}</li>
            <li>{t("s3.i3")}</li>
            <li>{t("s3.i4")}</li>
          </ul>
        </section>

        {/* Account Registration */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">4. {t("s4.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s4.p1")}</p>
          <p className="leading-relaxed text-foreground/90">{t("s4.p2")}</p>
          <p className="leading-relaxed text-foreground/90">{t("s4.p3")}</p>
        </section>

        {/* User Responsibilities */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">5. {t("s5.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s5.intro")}</p>

          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-medium mb-2">
                5.1 {t("s5.s1.title")}
              </h3>
              <p className="text-foreground/90">{t("s5.s1.p1")}</p>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">
                5.2 {t("s5.s2.title")}
              </h3>
              <p className="text-foreground/90">{t("s5.s2.p1")}</p>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">
                5.3 {t("s5.s3.title")}
              </h3>
              <p className="text-foreground/90">{t("s5.s3.p1")}</p>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">
                5.4 {t("s5.s4.title")}
              </h3>
              <p className="text-foreground/90">{t("s5.s4.p1")}</p>
            </div>
          </div>
        </section>

        {/* AI-Generated Content */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">6. {t("s6.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s6.p1")}</p>
          <p className="leading-relaxed text-foreground/90">{t("s6.p2")}</p>
          <div className="rounded-lg border-l-4 border-amber-500 bg-amber-50 dark:bg-amber-900/20 p-4">
            <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
              {t("s6.warning")}
            </p>
          </div>
        </section>

        {/* Prohibited Conduct */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">7. {t("s7.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s7.intro")}</p>
          <ul className="list-disc pl-6 space-y-1 text-foreground/90">
            <li>{t("s7.i1")}</li>
            <li>{t("s7.i2")}</li>
            <li>{t("s7.i3")}</li>
            <li>{t("s7.i4")}</li>
            <li>{t("s7.i5")}</li>
            <li>{t("s7.i6")}</li>
            <li>{t("s7.i7")}</li>
            <li>{t("s7.i8")}</li>
          </ul>
        </section>

        {/* Intellectual Property */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">8. {t("s8.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s8.p1")}</p>
          <p className="leading-relaxed text-foreground/90">{t("s8.p2")}</p>
          <p className="leading-relaxed text-foreground/90">{t("s8.p3")}</p>
        </section>

        {/* Service Availability */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">9. {t("s9.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s9.p1")}</p>
          <p className="leading-relaxed text-foreground/90">{t("s9.p2")}</p>
        </section>

        {/* Termination */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">10. {t("s10.title")}</h2>
          <div className="space-y-4">
            <div>
              <h3 className="text-lg font-medium mb-2">
                10.1 {t("s10.s1.title")}
              </h3>
              <p className="text-foreground/90">{t("s10.s1.p1")}</p>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">
                10.2 {t("s10.s2.title")}
              </h3>
              <p className="text-foreground/90">{t("s10.s2.p1")}</p>
            </div>

            <div>
              <h3 className="text-lg font-medium mb-2">
                10.3 {t("s10.s3.title")}
              </h3>
              <p className="text-foreground/90">{t("s10.s3.p1")}</p>
            </div>
          </div>
        </section>

        {/* Disclaimer of Warranties */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">11. {t("s11.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s11.p1")}</p>
          <p className="leading-relaxed text-foreground/90 uppercase text-xs tracking-wide">
            {t("s11.p2")}
          </p>
        </section>

        {/* Limitation of Liability */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">12. {t("s12.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s12.p1")}</p>
          <p className="leading-relaxed text-foreground/90 uppercase text-xs tracking-wide">
            {t("s12.p2")}
          </p>
        </section>

        {/* Indemnification */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">13. {t("s13.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s13.p1")}</p>
        </section>

        {/* Dispute Resolution */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">14. {t("s14.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s14.p1")}</p>
          <p className="leading-relaxed text-foreground/90">{t("s14.p2")}</p>
        </section>

        {/* Changes */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">15. {t("s15.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s15.p1")}</p>
          <p className="leading-relaxed text-foreground/90">{t("s15.p2")}</p>
        </section>

        {/* Severability */}
        <section className="space-y-4">
          <h2 className="text-2xl font-semibold">16. {t("s16.title")}</h2>
          <p className="leading-relaxed text-foreground/90">{t("s16.p1")}</p>
        </section>

        {/* Contact */}
        <section className="space-y-4 border-t border-border pt-8">
          <h2 className="text-2xl font-semibold">17. {t("s17.title")}</h2>
          <div className="space-y-3 text-foreground/90">
            <p>{t("s17.p1")}</p>
            <div className="rounded-lg border border-border bg-muted/30 p-6 space-y-2 text-sm">
              <p>
                <strong>{t("s17.company")}</strong>
              </p>
              <p>{t("s17.address")}</p>
              <p>
                <strong>{t("s17.emailLabel")}</strong> {t("s17.email")}
              </p>
            </div>
          </div>
        </section>

        {/* Footer note */}
        <div className="border-t border-border pt-6 text-center">
          <p className="text-sm text-muted-foreground">
            {t("footer")}{" "}
            <Link
              href="/privacy-policy"
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
