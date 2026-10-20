"use client";

import { startTransition, useActionState } from "react";
import { saveIconAction } from "../../actions";
import { ICON_SIZE } from "@/lib/settings";
import type { Messages } from "@/i18n/messages";

/** Turns any picture into the 64×64 PNG Minecraft shows, cropped to a square from the middle. */
async function toIcon(file: File): Promise<Blob> {
  const image = await createImageBitmap(file);
  const side = Math.min(image.width, image.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = ICON_SIZE;
  canvas.getContext("2d")!.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, ICON_SIZE, ICON_SIZE);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("no png"))), "image/png"));
}

export default function IconForm({ serverId, t }: { serverId: string; t: Messages["settings"] }) {
  const [state, action, pending] = useActionState(saveIconAction.bind(null, serverId), {});

  return (
    <div className="card stack">
      <label>
        {t.icon}
        <input
          type="file"
          accept="image/*"
          disabled={pending}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const data = new FormData();
            try {
              data.set("icon", await toIcon(file));
            } catch {
              data.set("icon", "");
            }
            startTransition(() => action(data));
          }}
        />
        <span className="muted small">{t.iconHint}</span>
      </label>
      {pending && <p className="muted small">{t.saving}</p>}
      {state.saved && <p className="small">{t.iconSaved}</p>}
      {state.error && <p className="error">{state.error === "iconInvalid" ? t.iconInvalid : t.errors.applyFailed}</p>}
    </div>
  );
}
