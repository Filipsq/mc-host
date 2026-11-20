import type { Metadata } from "next";
import { stat } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import { Apple, Download, ShieldAlert, Smartphone } from "lucide-react";
import { format } from "@/i18n/messages";
import { getMessages } from "@/i18n/server";
import { APK_URL } from "@/lib/mobileApp";

// Android gets a signed APK from public/pobierz (see android/README.md); iPhones
// get the installable website instead, since Apple allows no sideloading.

export async function generateMetadata(): Promise<Metadata> {
  const t = (await getMessages()).mobileApp;
  return { title: t.metaTitle, description: t.metaDescription, alternates: { canonical: "/aplikacja" } };
}

async function apkSize() {
  try {
    const { size } = await stat(path.join(process.cwd(), "public", APK_URL));
    return `${(size / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
  } catch {
    return null;
  }
}

export default async function AppPage() {
  const t = (await getMessages()).mobileApp;
  const size = await apkSize();
  const qr = await QRCode.toString(`${process.env.APP_URL ?? "https://mchosting.pl"}/aplikacja`, {
    type: "svg",
    margin: 1,
    color: { dark: "#0b0f14", light: "#ffffff" },
  }).catch(() => undefined);

  return (
    <main className="wide-form stack">
      <h1>{t.title}</h1>
      <p className="muted">{t.intro}</p>

      <section className="card stack">
        <div className="row app-card-head">
          <Smartphone size={24} aria-hidden />
          <h2>{t.androidTitle}</h2>
        </div>
        <p>{t.androidText}</p>
        {size && (
          <div className="stack-tight">
            <a className="button large" href={APK_URL} download="mchosting.apk">
              <Download size={18} aria-hidden /> {t.download}
            </a>
            <span className="muted small">{format(t.size, { size })}</span>
          </div>
        )}
        <h3>{t.stepsTitle}</h3>
        <ol className="invite-steps">
          <li>{t.step1}</li>
          <li>{t.step2}</li>
          <li>{t.step3}</li>
          <li>{t.step4}</li>
        </ol>
        <div className="notice small">
          <ShieldAlert size={16} aria-hidden /> <strong>{t.warnTitle}</strong> {t.warnText}
        </div>
      </section>

      <section className="card stack">
        <div className="row app-card-head">
          <Apple size={24} aria-hidden />
          <h2>{t.iosTitle}</h2>
        </div>
        <p>{t.iosText}</p>
        <ol className="invite-steps">
          <li>{t.ios1}</li>
          <li>{t.ios2}</li>
          <li>{t.ios3}</li>
          <li>{t.ios4}</li>
        </ol>
      </section>

      {qr && (
        <div className="card app-qr app-page-qr">
          {/* The SVG is made on our server from our own address (qrcode library), not from user input. */}
          <span className="app-qr-code" dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="muted small">{t.qrHint}</p>
        </div>
      )}
    </main>
  );
}
