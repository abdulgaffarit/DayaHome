/**
 * Email provider abstraction.
 *
 * Nothing in the app imports a concrete provider: `getEmailProvider()` picks
 * one from configuration, so switching from console logging to Resend or SMTP
 * is an environment change rather than a code change.
 */
export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailProvider {
  readonly name: string;
  send(message: EmailMessage): Promise<{ ok: boolean; error?: string }>;
}

/** Development default — writes the message to the Worker log. */
export class ConsoleEmailProvider implements EmailProvider {
  readonly name = "console";
  async send(message: EmailMessage) {
    console.info(`[email:console] to=${message.to} subject=${message.subject}\n${message.text}`);
    return { ok: true };
  }
}

export class ResendEmailProvider implements EmailProvider {
  readonly name = "resend";
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage) {
    try {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          html: message.html,
          text: message.text,
        }),
      });
      if (!response.ok) {
        return { ok: false, error: `resend_http_${response.status}` };
      }
      return { ok: true };
    } catch (error) {
      console.error("[email:resend] send failed", error);
      return { ok: false, error: "resend_unreachable" };
    }
  }
}

/**
 * SMTP placeholder.
 *
 * TODO: Workers cannot open raw TCP to an SMTP server, so a real SMTP setup
 * needs an HTTP relay (Cloudflare Email Routing, or a provider's REST API).
 * Selecting `EMAIL_PROVIDER=smtp` therefore fails loudly instead of silently
 * dropping mail.
 */
export class UnconfiguredSmtpProvider implements EmailProvider {
  readonly name = "smtp";
  async send(message: EmailMessage) {
    console.error(
      `[email:smtp] NOT IMPLEMENTED — message to ${message.to} was not sent. ` +
        `Workers have no raw TCP; configure EMAIL_PROVIDER=resend or an HTTP relay.`,
    );
    return { ok: false, error: "smtp_not_implemented" };
  }
}

export function createEmailProvider(config: {
  provider?: string;
  resendApiKey?: string;
  from?: string;
}): EmailProvider {
  const from = config.from ?? "dayarampur.com <no-reply@dayarampur.com>";
  switch ((config.provider ?? "console").toLowerCase()) {
    case "resend":
      return config.resendApiKey
        ? new ResendEmailProvider(config.resendApiKey, from)
        : new ConsoleEmailProvider();
    case "smtp":
      return new UnconfiguredSmtpProvider();
    default:
      return new ConsoleEmailProvider();
  }
}
