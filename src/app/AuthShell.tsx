import Clouds from "@/components/Clouds";

type Props = { title: string; subtitle: string; children: React.ReactNode; below?: React.ReactNode };

/**
 * Log-in and sign-up: one card floating in a Minecraft evening sky, with blocky clouds
 * drifting by and a strip of grass blocks at the bottom. One title, one main button.
 */
export default function AuthShell({ title, subtitle, children, below }: Props) {
  return (
    <main className="auth-scene">
      <Clouds />
      <div className="auth-ground" aria-hidden />
      <div className="auth-wrap stack">
        <div className="auth-card stack">
          <header className="auth-head">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="auth-logo" src="/art/block-grass.svg" alt="" width={52} height={52} />
            <h1>{title}</h1>
            <p className="muted">{subtitle}</p>
          </header>
          {children}
        </div>
        {below}
      </div>
    </main>
  );
}
