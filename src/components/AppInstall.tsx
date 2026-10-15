"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, Download, Smartphone } from "lucide-react";
import type { Messages } from "@/i18n/messages";

type Labels = Messages["app"];
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
type PushState = "unsupported" | "needsInstall" | "denied" | "off" | "on" | "busy";

/** Running as the installed app rather than in a browser tab. */
function standalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  // iPadOS reports itself as a Mac, but with touch.
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function keyBytes(base64url: string) {
  const raw = atob(base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "="));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function save(sub: PushSubscription) {
  const res = await fetch("/api/push", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  if (!res.ok) throw new Error(`push subscribe answered ${res.status}`);
}

/**
 * The "App on your phone" card in the panel: installs the site as an app
 * (Android and desktop Chrome/Edge ask with one tap, an iPhone needs Share >
 * Add to Home Screen) and turns this device's notifications on or off.
 */
export default function AppInstall({ labels, pushKey }: { labels: Labels; pushKey: string | null }) {
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [phone, setPhone] = useState(true);
  const [prompt, setPrompt] = useState<InstallPrompt | null>(null);
  const [push, setPush] = useState<PushState>("unsupported");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setInstalled(standalone());
    setIos(isIos());
    setPhone(window.matchMedia("(pointer: coarse)").matches);
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setPrompt(e as InstallPrompt);
    };
    const onInstalled = () => {
      setPrompt(null);
      setInstalled(true);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);

    (async () => {
      const supported = !!pushKey && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
      if (!supported) {
        // Safari on an iPhone only offers notifications to the app on the home screen.
        setPush(pushKey && isIos() && !standalone() ? "needsInstall" : "unsupported");
        return;
      }
      if (Notification.permission === "denied") return setPush("denied");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub && Notification.permission === "granted") {
        // Keeps the device tied to whoever is signed in now (logging out unlinks it).
        await save(sub).catch(() => {});
        setPush("on");
      } else {
        setPush("off");
      }
    })()
      .catch(() => setPush("unsupported"))
      .finally(() => setReady(true));

    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [pushKey]);

  const install = useCallback(async () => {
    if (!prompt) return;
    await prompt.prompt();
    const { outcome } = await prompt.userChoice;
    setPrompt(null);
    if (outcome === "accepted") setInstalled(true);
  }, [prompt]);

  const turnOn = useCallback(async () => {
    if (!pushKey) return;
    setFailed(false);
    setPush("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setPush(permission === "denied" ? "denied" : "off");
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(pushKey) }));
      await save(sub);
      setPush("on");
    } catch {
      setFailed(true);
      setPush("off");
    }
  }, [pushKey]);

  const turnOff = useCallback(async () => {
    setFailed(false);
    setPush("busy");
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      await fetch("/api/push", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpoint: sub?.endpoint }),
      });
      await sub?.unsubscribe();
      setPush("off");
    } catch {
      setFailed(true);
      setPush("on");
    }
  }, []);

  if (!ready) return null;
  // Nothing to offer: a browser that can neither install the site nor show notifications.
  if (installed && push === "unsupported") return null;

  return (
    <div className="card stack app-card">
      <div className="row app-card-head">
        <Smartphone size={24} aria-hidden />
        <span className="stack-tight">
          <strong>{installed ? labels.installedTitle : labels.title}</strong>
          <span className="muted small">{installed ? labels.installedHint : labels.hint}</span>
        </span>
      </div>
      <div className="row app-card-actions">
        {!installed && prompt && (
          <button type="button" onClick={install}>
            <Download size={18} aria-hidden /> {labels.install}
          </button>
        )}
        {(push === "off" || push === "busy") && (
          <button type="button" className={prompt && !installed ? "secondary" : undefined} onClick={turnOn} disabled={push === "busy"}>
            <Bell size={18} aria-hidden /> {labels.notificationsOn}
          </button>
        )}
        {push === "on" && (
          <>
            <span className="chip"><Bell size={14} aria-hidden /> {labels.notificationsEnabled}</span>
            <button type="button" className="small secondary" onClick={turnOff}>
              <BellOff size={16} aria-hidden /> {labels.notificationsOff}
            </button>
          </>
        )}
      </div>
      {!installed && !prompt && <p className="muted small">{ios ? labels.iosSteps : phone ? labels.otherSteps : labels.desktopSteps}</p>}
      {push === "needsInstall" && <p className="muted small">{labels.iosPush}</p>}
      {push === "denied" && <p className="muted small">{labels.denied}</p>}
      {failed && <p className="notice warn small">{labels.failed}</p>}
    </div>
  );
}
