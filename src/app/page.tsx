import Link from "next/link";

export default function Home() {
  return (
    <main className="narrow">
      <h1>Minecraft servers in one click</h1>
      <p>Host a Java or Bedrock server for free, or upgrade for more players and always-on uptime.</p>
      <div className="row">
        <Link className="button" href="/signup">Get started free</Link>
        <Link href="/login">Log in</Link>
      </div>
    </main>
  );
}
