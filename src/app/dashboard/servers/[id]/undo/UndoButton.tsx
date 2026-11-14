"use client";

import { useFormStatus } from "react-dom";

function Submit({ label, pendingLabel, question }: { label: string; pendingLabel: string; question: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="secondary"
      disabled={pending}
      onClick={(e) => {
        if (!confirm(question)) e.preventDefault();
      }}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}

/** "Cofnij zmianę", asking first: the server restarts on its old world if it's on. */
export default function UndoButton({ action, label, pendingLabel, question }: { action: () => Promise<void>; label: string; pendingLabel: string; question: string }) {
  return (
    <form action={action}>
      <Submit label={label} pendingLabel={pendingLabel} question={question} />
    </form>
  );
}
