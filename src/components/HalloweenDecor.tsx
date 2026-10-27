// Halloween decorations over the whole site (lib/halloween.ts): cobwebs in the
// top corners and spiders hanging from the top bar. Only drawn, never in the way:
// they let clicks through and keep still without animations.

function Cobweb({ className }: { className: string }) {
  // Threads fanning out from the corner, joined by sagging rings.
  const angles = [0, 15, 30, 45, 60, 75, 90].map((a) => (a * Math.PI) / 180);
  const point = (r: number, a: number) => `${(r * Math.cos(a)).toFixed(1)} ${(r * Math.sin(a)).toFixed(1)}`;
  const ring = (r: number) =>
    angles
      .slice(1)
      .map((a, i) => {
        const mid = (a + angles[i]) / 2;
        return `${i === 0 ? `M${point(r, angles[0])}` : ""} Q${point(r * 0.8, mid)} ${point(r, a)}`;
      })
      .join(" ");
  return (
    <svg className={`cobweb ${className}`} width="150" height="150" viewBox="0 0 150 150" aria-hidden>
      <g fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round">
        {angles.map((a) => (
          <path key={a} d={`M0 0 L${point(160, a)}`} />
        ))}
        {[28, 54, 82, 112, 142].map((r) => (
          <path key={r} d={ring(r)} />
        ))}
      </g>
    </svg>
  );
}

function Spider({ className, thread }: { className: string; thread: number }) {
  return (
    <span className={`spider ${className}`} style={{ ["--thread" as string]: `${thread}px` }} aria-hidden>
      <svg width="30" height="26" viewBox="0 0 30 26">
        <g stroke="#1b1024" strokeWidth="2" strokeLinecap="round" fill="none">
          <path d="M11 11 L4 5 L1 9" />
          <path d="M11 13 L3 12 L0 17" />
          <path d="M11 15 L4 18 L2 24" />
          <path d="M12 17 L7 22 L6 26" />
          <path d="M19 11 L26 5 L29 9" />
          <path d="M19 13 L27 12 L30 17" />
          <path d="M19 15 L26 18 L28 24" />
          <path d="M18 17 L23 22 L24 26" />
        </g>
        <ellipse cx="15" cy="15" rx="6" ry="7" fill="#1b1024" />
        <circle cx="15" cy="7.5" r="4" fill="#1b1024" />
        <circle cx="13.5" cy="7" r="1.1" fill="#ff4d2e" />
        <circle cx="16.5" cy="7" r="1.1" fill="#ff4d2e" />
      </svg>
    </span>
  );
}

export default function HalloweenDecor() {
  return (
    <div className="halloween-decor" aria-hidden>
      <Cobweb className="cobweb-left" />
      <Cobweb className="cobweb-right" />
      <Spider className="spider-a" thread={90} />
      <Spider className="spider-b" thread={150} />
    </div>
  );
}
