// A company detail from src/lib/company.ts, or a visible blank while it's missing.
export default function Blank({ value, label }: { value: string; label: string }) {
  return value ? <>{value}</> : <mark className="blank">[{label}]</mark>;
}
