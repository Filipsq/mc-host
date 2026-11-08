"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { LayoutList, PanelLeft } from "lucide-react";
import { setClassicPanelAction } from "../actions";

type Props = { classic: boolean; t: { toClassic: string; toMenu: string }; className?: string };

/** Switches the server panel between the menu on the left and the classic one-page look. */
export default function PanelViewToggle({ classic, t, className = "secondary small" }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      className={className}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setClassicPanelAction(!classic);
          router.refresh();
        })
      }
    >
      {classic ? <PanelLeft size={16} aria-hidden /> : <LayoutList size={16} aria-hidden />} {classic ? t.toMenu : t.toClassic}
    </button>
  );
}
