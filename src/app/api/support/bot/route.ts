import { NextResponse } from "next/server";
import { handleBotReply } from "@/lib/supportBot";

export const dynamic = "force-dynamic";

/**
 * The support bot's answer (src/lib/supportBot.ts): OpenBot POSTs
 * { token, text, escalate, screenshot?, image? } with the token that came with the question.
 * screenshot: a key from src/lib/supportScreens.json (a ready panel screenshot);
 * image: a PNG/JPG/WebP/GIF as base64.
 * `escalate: true` hands the chat to the admins, with `text` as the bot's
 * goodbye if given.
 */
export async function POST(req: Request) {
  let input: unknown;
  try {
    input = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "badJson" }, { status: 400 });
  }
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const token = typeof o.token === "string" ? o.token : "";
  const text = typeof o.text === "string" ? o.text : "";
  const escalate = o.escalate === true || o.escalate === "true";
  const image = typeof o.image === "string" && o.image ? o.image : undefined;
  const screenshot = typeof o.screenshot === "string" && o.screenshot ? o.screenshot : undefined;
  const result = await handleBotReply(token, text, escalate, image, screenshot);
  if (result.ok) return NextResponse.json({ ok: true });
  return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
}
