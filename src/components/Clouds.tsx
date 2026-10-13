// Flat, blocky clouds like Minecraft's, drifting slowly across the top of the
// home page. Each is drawn twice: a darker copy one block lower is its side.

type Rect = readonly [x: number, y: number, w: number, h: number];

const SHAPES: readonly (readonly Rect[])[] = [
  [[2, 0, 6, 1], [0, 1, 12, 2], [3, 3, 7, 1]],
  [[0, 0, 4, 1], [6, 0, 3, 1], [0, 1, 14, 2], [1, 3, 5, 1]],
  [[3, 0, 5, 1], [1, 1, 9, 1], [0, 2, 11, 1]],
];

// Shape, height on the page (%), block size (px), seconds to cross, and how far
// across it starts, so the sky isn't empty when the page opens.
const CLOUDS = [
  { shape: 0, top: 6, unit: 14, seconds: 95, start: 0.12 },
  { shape: 1, top: 24, unit: 10, seconds: 125, start: 0.5 },
  { shape: 2, top: 62, unit: 8, seconds: 150, start: 0.78 },
  { shape: 0, top: 80, unit: 7, seconds: 170, start: 0.3 },
  { shape: 1, top: 3, unit: 6, seconds: 115, start: 0.9 },
  { shape: 2, top: 42, unit: 11, seconds: 135, start: 0.62 },
] as const;

export default function Clouds() {
  return (
    <div className="clouds" aria-hidden>
      {CLOUDS.map((c, i) => {
        const rects = SHAPES[c.shape];
        const w = Math.max(...rects.map(([x, , rw]) => x + rw));
        const h = Math.max(...rects.map(([, y, , rh]) => y + rh)) + 1;
        return (
          <svg
            key={i}
            className="cloud"
            width={w * c.unit}
            height={h * c.unit}
            viewBox={`0 0 ${w} ${h}`}
            shapeRendering="crispEdges"
            style={{ top: `${c.top}%`, animationDuration: `${c.seconds}s`, animationDelay: `${-c.seconds * c.start}s` }}
          >
            {rects.map(([x, y, rw, rh], j) => (
              <rect key={`s${j}`} className="cloud-side" x={x} y={y + 1} width={rw} height={rh} />
            ))}
            {rects.map(([x, y, rw, rh], j) => (
              <rect key={`t${j}`} className="cloud-top" x={x} y={y} width={rw} height={rh} />
            ))}
          </svg>
        );
      })}
    </div>
  );
}
