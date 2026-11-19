import { useEffect, useState } from "react";
import type { EmailProviderStatus } from "@maritime/shared";
import { api } from "./api.js";

let cached: Promise<EmailProviderStatus | null> | null = null;

/**
 * Whether the outgoing email provider (SMTP in .env) is set up. One request
 * per page load, shared by every panel that can send email.
 */
export function useEmailProvider(): EmailProviderStatus | null {
  const [status, setStatus] = useState<EmailProviderStatus | null>(null);
  useEffect(() => {
    cached ??= api
      .getMeta()
      .then((m) => m.emailProvider ?? null)
      .catch(() => null);
    let live = true;
    void cached.then((s) => {
      if (live) setStatus(s);
    });
    return () => {
      live = false;
    };
  }, []);
  return status;
}
