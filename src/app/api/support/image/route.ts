import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { isAdmin } from "@/lib/admin";
import { getPreferences } from "@/i18n/server";
import { IMAGE_MAX_BYTES, postMessage } from "@/lib/support";

export const dynamic = "force-dynamic";

/**
 * Sends a chat message with a picture, as multipart form data: `image`, an
 * optional `text`, and `chat` (a user's id) when an admin answers that user.
 * Text-only messages go through the sendSupportMessage server action.
 */
export async function POST(req: NextRequest) {
  // Only the site's own pages may post here.
  const origin = req.headers.get("origin");
  if (origin && URL.canParse(origin) && new URL(origin).host !== req.headers.get("host")) {
    return NextResponse.json({ ok: false, error: "signedOut" }, { status: 403 });
  }
  const session = await getSession();
  if (!session?.user?.id) return NextResponse.json({ ok: false, error: "signedOut" }, { status: 401 });
  const length = Number(req.headers.get("content-length") ?? 0);
  if (length > IMAGE_MAX_BYTES + 64 * 1024) return NextResponse.json({ ok: false, error: "imageTooBig" }, { status: 413 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: "imageType" }, { status: 400 });
  }
  const file = form.get("image");
  if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "imageType" }, { status: 400 });
  if (file.size > IMAGE_MAX_BYTES) return NextResponse.json({ ok: false, error: "imageTooBig" }, { status: 413 });
  const picture = new Uint8Array(await file.arrayBuffer());
  const text = String(form.get("text") ?? "");
  const chat = form.get("chat");
  const { locale } = await getPreferences();

  const userId = session.user.id;
  if (typeof chat === "string" && chat) {
    if (!(await isAdmin(userId))) return NextResponse.json({ ok: false, error: "signedOut" }, { status: 403 });
    return NextResponse.json(await postMessage(chat, "staff", userId, text, locale, picture));
  }
  return NextResponse.json(await postMessage(userId, "user", userId, text, locale, picture));
}
