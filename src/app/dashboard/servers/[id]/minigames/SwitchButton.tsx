"use client";

import { useFormStatus } from "react-dom";

function Submit({ label, pendingLabel }: { label: string; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}>
      {pending ? pendingLabel : label}
    </button>
  );
}

/** One button that runs a server action, saying it's working meanwhile (the switch takes a while). */
export default function SwitchButton({ action, label, pendingLabel }: { action: () => Promise<void>; label: string; pendingLabel: string }) {
  return (
    <form action={action}>
      <Submit label={label} pendingLabel={pendingLabel} />
    </form>
  );
}
