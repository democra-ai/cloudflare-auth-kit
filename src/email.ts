import { EmailMessage } from "cloudflare:email";
import { createMimeMessage } from "mimetext/browser";
import type { Env } from "./types";

const EMAIL_RE = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

export type SendResult = { ok: true; via: "resend" | "email_routing" } | { ok: false; error: string };

/**
 * Outbound email adapter — two backends, in priority order:
 *  1. Resend — if RESEND_API_KEY is set. Sends to ANY recipient.
 *  2. Cloudflare Email Routing `send_email` binding (EMAIL) — free, but only delivers to
 *     addresses VERIFIED as destinations on your Cloudflare account. Fine for admin
 *     sign-in codes; use Resend for codes to arbitrary end users.
 *
 * Email OTP sign-in turns on automatically when either backend + EMAIL_FROM is configured.
 */
export function emailReady(env: Env): boolean {
  return Boolean((env.RESEND_API_KEY || env.EMAIL) && (env.EMAIL_FROM ?? "").trim());
}

export async function sendEmail(
  env: Env,
  args: {
    to: string;
    subject: string;
    text: string;
    /** Sender address override. Defaults to EMAIL_FROM. Must be on a verified Email Routing zone. */
    from?: string;
    /** Display name, e.g. "CiteTrack" → From: CiteTrack <citetrack@democra.ai>. */
    fromName?: string;
    /** Optional HTML body (added as a second MIME part / Resend `html` field). */
    html?: string;
  },
): Promise<SendResult> {
  const to = args.to.trim();
  const from = (args.from ?? env.EMAIL_FROM ?? "").trim();
  const fromName = (args.fromName ?? "").trim();
  if (!EMAIL_RE.test(to)) return { ok: false, error: "invalid recipient" };
  if (!EMAIL_RE.test(from)) return { ok: false, error: "invalid sender (EMAIL_FROM)" };

  if (env.RESEND_API_KEY) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: fromName ? `${fromName} <${from}>` : from,
        to,
        subject: args.subject,
        text: args.text,
        ...(args.html ? { html: args.html } : {}),
      }),
    });
    if (!res.ok) return { ok: false, error: `resend: ${res.status} ${await res.text()}` };
    return { ok: true, via: "resend" };
  }

  if (!env.EMAIL) return { ok: false, error: "no email backend (set RESEND_API_KEY or bind send_email)" };
  const msg = createMimeMessage();
  // Display name rides in the MIME From header; the envelope MAIL FROM stays the bare address.
  msg.setSender(fromName ? { name: fromName, addr: from } : { addr: from });
  msg.setRecipient(to);
  msg.setSubject(args.subject);
  msg.addMessage({ contentType: "text/plain", data: args.text });
  if (args.html) msg.addMessage({ contentType: "text/html", data: args.html });
  try {
    await env.EMAIL.send(new EmailMessage(from, to, msg.asRaw()));
    return { ok: true, via: "email_routing" };
  } catch (e) {
    // The overwhelmingly common cause: `to` is not a verified destination address.
    return { ok: false, error: `email_routing: ${e instanceof Error ? e.message : String(e)}` };
  }
}
