/* eslint-disable @next/next/no-img-element */
// Small pictures for the home page: one per feature, per step and per ready game.
// They're drawn with the site's block art and plain HTML, and only animate
// transform and opacity so they stay smooth on phones.
import { Check, Gamepad2, Mail, Monitor, Smartphone } from "lucide-react";
import type { GameId } from "@/lib/games";
import type { Messages } from "@/i18n/messages";

type Art = Messages["home"]["art"];

export type FeatureKey = "free" | "editions" | "sleep" | "address" | "console" | "payments";

export function FeatureArt({ kind, art, domain, online, zero }: { kind: FeatureKey; art: Art; domain: string; online: string; zero: string }) {
  switch (kind) {
    case "free":
      return (
        <div className="art art-free" aria-hidden>
          <img className="art-bob" src="/art/block-grass.svg" alt="" width={84} height={96} />
          <span className="art-price">{zero}</span>
          <span className="art-spark s1" />
          <span className="art-spark s2" />
          <span className="art-spark s3" />
        </div>
      );
    case "editions":
      return (
        <div className="art art-editions" aria-hidden>
          <span className="device d-java"><Monitor size={20} /><b>Java</b></span>
          <svg className="links" viewBox="0 0 200 100" preserveAspectRatio="none">
            <path d="M40 50 H85" /><path d="M115 50 H160" />
          </svg>
          <img className="art-server" src="/art/block-server.svg" alt="" width={46} height={52} />
          <span className="device d-bedrock"><Smartphone size={18} /><Gamepad2 size={18} /><b>Bedrock</b></span>
        </div>
      );
    case "sleep":
      return (
        <div className="art art-sleep" aria-hidden>
          <img src="/art/block-server.svg" alt="" width={64} height={72} />
          <span className="zzz"><i>z</i><i>z</i><i>Z</i></span>
          <span className="sleep-chip chip-asleep"><span className="dot" /> {art.asleep}</span>
          <span className="sleep-chip chip-online"><span className="dot online" /> {online}</span>
          <span className="join-chip">{art.joining}</span>
        </div>
      );
    case "address":
      return (
        <div className="art art-address" aria-hidden>
          <span className="mc-label">{art.addressLabel}</span>
          <span className="mc-input">
            twojserwer.{domain}
            <span className="caret" />
          </span>
          <span className="mc-ok"><Check size={14} /> {art.ready}</span>
        </div>
      );
    case "console":
      return (
        <div className="art art-console" aria-hidden>
          <div className="term">
            <span className="t-line"><em>[INFO]</em> Done (3.1s)!</span>
            <span className="t-line"><em>[INFO]</em> Ola joined the game</span>
            <span className="t-line t-cmd">&gt; time set day</span>
          </div>
          <div className="mini-chart">
            <span className="mini-head"><span className="dot online" /> 3/10</span>
            <svg viewBox="0 0 80 36" preserveAspectRatio="none">
              <path className="area" d="M0 30 L10 26 L20 28 L30 18 L40 20 L50 12 L60 15 L70 8 L80 10 V36 H0 Z" />
              <path className="line" d="M0 30 L10 26 L20 28 L30 18 L40 20 L50 12 L60 15 L70 8 L80 10" />
            </svg>
          </div>
        </div>
      );
    case "payments":
      return (
        <div className="art art-payments" aria-hidden>
          <span className="pay-row">
            <span className="pay-chip blik">BLIK</span>
            <span className="pay-chip p24">Przelewy24</span>
          </span>
          <span className="period-row">
            {[7, 30, 60, 90].map((d) => (
              <span key={d} className={`period${d === 90 ? " best" : ""}`}>
                <b>{d}</b>
                <small>{d === 90 ? "−10%" : art.days}</small>
              </span>
            ))}
          </span>
        </div>
      );
  }
}

export function StepArt({ step, art, signUp, domain }: { step: number; art: Art; signUp: string; domain: string }) {
  if (step === 0)
    return (
      <div className="art art-step art-signup" aria-hidden>
        <span className="fake-field"><Mail size={14} /> {art.email}</span>
        <span className="fake-field dots">••••••••</span>
        <span className="fake-button">{signUp}</span>
      </div>
    );
  if (step === 1)
    return (
      <div className="art art-step art-pick" aria-hidden>
        <span className="pick-tiles">
          <span className="pick-tile"><img src="/art/block-grass.svg" alt="" width={40} height={46} /><b>Java</b></span>
          <span className="pick-tile"><img src="/art/games/oneblock-stone.svg" alt="" width={40} height={46} /><b>Bedrock</b></span>
          <span className="pick-tile"><img src="/art/sword.svg" alt="" width={34} height={34} /><b>Terraria</b></span>
          <span className="pick-ring" />
        </span>
      </div>
    );
  return (
    <div className="art art-step art-join" aria-hidden>
      <span className="mc-server">
        <img src="/art/island.svg" alt="" width={44} height={41} />
        <span className="mc-server-text">
          <b>ekipa.{domain}</b>
          <small>3/10 {art.players}</small>
        </span>
        <span className="signal"><i /><i /><i /><i /><i /></span>
      </span>
    </div>
  );
}

const BADGES: Partial<Record<GameId, string>> = { lifesteal: "heart", modpack: "gear", mods: "wrench" };

export function GameArt({ id }: { id: GameId }) {
  const badge = BADGES[id];
  return (
    <div className={`game-art game-art-${id}`} aria-hidden>
      {id === "oneblock" ? (
        <span className="oneblock art-bob">
          {["grass", "stone", "log", "ore"].map((type) => (
            <img key={type} src={`/art/games/oneblock-${type}.svg`} alt="" width={64} height={72} />
          ))}
        </span>
      ) : (
        <img className="art-bob" src={`/art/games/${id}.svg`} alt="" width={120} height={120} />
      )}
      {badge && <img className={`game-badge badge-${badge}`} src={`/art/${badge}.svg`} alt="" width={30} height={30} />}
    </div>
  );
}
