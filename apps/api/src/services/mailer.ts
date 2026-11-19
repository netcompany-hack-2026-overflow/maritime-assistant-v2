import nodemailer, { type Transporter } from "nodemailer";
import { mailEnv } from "../lib/env.js";

/**
 * The outgoing email provider: plain SMTP via nodemailer, configured from
 * .env (SMTP_* and MAIL_*). Nothing is ever sent without a person pressing
 * Send on a draft.
 */

export interface MailerStatus {
  configured: boolean;
  /** "Name <address>" replies go out as, or null when not configured. */
  from: string | null;
  /** Set when MAIL_REDIRECT_TO sends everything to a test inbox instead. */
  redirectTo: string | null;
  /** What's missing, in plain words, when not configured. */
  missing: string[];
}

export function mailerStatus(): MailerStatus {
  const missing: string[] = [];
  if (!mailEnv.host) missing.push("SMTP_HOST");
  if (!mailEnv.from) missing.push("MAIL_FROM");
  // A user without a password (or the reverse) is a half-filled .env, not an open relay.
  if (mailEnv.user && !mailEnv.pass) missing.push("SMTP_PASS");
  if (!mailEnv.user && mailEnv.pass) missing.push("SMTP_USER");
  const configured = missing.length === 0;
  return {
    configured,
    from: configured ? `${mailEnv.fromName} <${mailEnv.from}>` : null,
    redirectTo: mailEnv.redirectTo || null,
    missing,
  };
}

let transporter: Transporter | null = null;

function transport(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: mailEnv.host,
      port: mailEnv.port,
      secure: mailEnv.secure,
      auth: mailEnv.user ? { user: mailEnv.user, pass: mailEnv.pass } : undefined,
      connectionTimeout: 15_000,
      greetingTimeout: 15_000,
      socketTimeout: 30_000,
    });
  }
  return transporter;
}

export class MailerError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface OutgoingMail {
  /** One address, or several separated by commas. */
  to: string;
  cc?: string;
  subject: string;
  text: string;
}

/** Send one plain-text email. Returns the provider's message id and where it actually went. */
export async function sendMail(mail: OutgoingMail): Promise<{ messageId: string; deliveredTo: string }> {
  const status = mailerStatus();
  if (!status.configured) {
    throw new MailerError(
      503,
      `Ο email provider δεν έχει ρυθμιστεί. Συμπληρώστε ${status.missing.join(", ")} στο .env και κάντε restart το API.`
    );
  }
  const deliveredTo = mailEnv.redirectTo || mail.to;
  const original = mail.cc ? `${mail.to}, cc ${mail.cc}` : mail.to;
  const subject = mailEnv.redirectTo ? `[test, for ${original}] ${mail.subject}` : mail.subject;
  try {
    const info = await transport().sendMail({
      from: { name: mailEnv.fromName, address: mailEnv.from },
      to: deliveredTo,
      // In test mode nothing reaches the real recipients, Cc included.
      cc: mailEnv.redirectTo ? undefined : mail.cc || undefined,
      bcc: mailEnv.bcc || undefined,
      replyTo: mailEnv.replyTo || undefined,
      subject,
      text: mail.text,
    });
    return { messageId: String(info.messageId ?? ""), deliveredTo };
  } catch (err) {
    // Auth failures, refused recipients, timeouts: say what the provider said, never the credentials.
    const reason = err instanceof Error ? err.message : String(err);
    throw new MailerError(502, `Ο email provider δεν δέχτηκε το μήνυμα: ${reason}`);
  }
}
