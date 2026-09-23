import type { MessagingAdapter, MessageOption, RichMessage } from "../runtime/types.js";

// One recorded outgoing message. `options` is present for buttons/list
// so the test panel can render tappable choices. `media` carries a header
// image/video/document so the test panel can render a real preview (#12).
export interface SentMessage {
    to: string;
    text: string;
    options?: MessageOption[];
    media?: { type: "image" | "document" | "video"; url: string };
    cta?: { label: string; url: string };
}

// A test Adapter that records outgoing messages (no real WhatsApp).
export class ConsoleAdapter implements MessagingAdapter {

    public sent: SentMessage[] = []

    async sendText(to: string, text: string): Promise<void> {
        this.sent.push({ to, text });
        console.log(`[Console Adapter ] -> ${to} : ${text}`)
    }

    async sendButtons(to: string, text: string, buttons: MessageOption[]): Promise<void> {
        this.sent.push({ to, text, options: buttons });
        console.log(`[Console Adapter ] -> ${to} : ${text} [buttons: ${buttons.map((b) => b.label).join(", ")}]`);
    }

    async sendList(to: string, text: string, _buttonText: string, rows: MessageOption[]): Promise<void> {
        this.sent.push({ to, text, options: rows });
        console.log(`[Console Adapter ] -> ${to} : ${text} [list: ${rows.map((r) => r.label).join(", ")}]`);
    }

    // #12 — text header/footer combine into text; media header is passed
    // separately so the test panel can render an actual preview.
    async sendRichMessage(to: string, msg: RichMessage): Promise<void> {
        const parts: string[] = [];
        if (msg.header?.type === "text") parts.push(msg.header.value);
        parts.push(msg.body);
        if (msg.footer) parts.push(msg.footer);
        const text = parts.join("\n");
        const media =
            msg.header && msg.header.type !== "text"
                ? { type: msg.header.type, url: msg.header.value }
                : undefined;
        this.sent.push({ to, text, media });
        console.log(`[Console Adapter ] -> ${to} : ${media ? `[${media.type}] ${media.url} ` : ""}${text}`);
    }

    // #10 — a CTA URL button; pass the cta separately for a real link button.
    async sendCtaUrl(to: string, text: string, buttonText: string, url: string, footer?: string): Promise<void> {
        const rendered = footer ? `${text}\n${footer}` : text;
        this.sent.push({ to, text: rendered, cta: { label: buttonText, url } });
        console.log(`[Console Adapter ] -> ${to} : ${rendered} [${buttonText}] ${url}`);
    }
}

// The real Whats app Adapter. Sends mesage via MEta's Cloud API.
// It needds the chatbot's phoneNumberId and accesstoken (backend-only secrets)
export class WhatsAppAdapter implements MessagingAdapter {
    constructor(
        private phoneNumberId: string,
        private accessToken: string
    ) { }

    async sendText(to: string, text: string): Promise<void> {

        const url = `https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`;
        const res = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                messaging_product: "whatsapp",
                to,
                type: "text",
                text: { body: text },
            }),
        });

        if (!res.ok) {
            const detail = await res.text();
            throw new Error(`WhatsApp send failed (${res.status}): ${detail}`);
        }
    }

    // Shared POST helper for the messages endpoint.
    private async post(body: any): Promise<void> {
        const url = `https://graph.facebook.com/v21.0/${this.phoneNumberId}/messages`;
        const res = await fetch(url, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${this.accessToken}`,
                "Content-Type": "application/json",
            },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const detail = await res.text();
            throw new Error(`WhatsApp send failed (${res.status}): ${detail}`);
        }
    }

    // Interactive reply buttons (WhatsApp allows up to 3).
    async sendButtons(to: string, text: string, buttons: MessageOption[]): Promise<void> {
        await this.post({
            messaging_product: "whatsapp",
            to,
            type: "interactive",
            interactive: {
                type: "button",
                body: { text },
                action: {
                    buttons: buttons.slice(0, 3).map((b) => ({
                        type: "reply",
                        reply: { id: b.id, title: b.label.slice(0, 20) },
                    })),
                },
            },
        });
    }

    // Interactive list (WhatsApp allows up to 10 rows).
    async sendList(to: string, text: string, buttonText: string, rows: MessageOption[]): Promise<void> {
        await this.post({
            messaging_product: "whatsapp",
            to,
            type: "interactive",
            interactive: {
                type: "list",
                body: { text },
                action: {
                    button: (buttonText || "Select").slice(0, 20),
                    sections: [
                        {
                            title: "Options",
                            rows: rows.slice(0, 10).map((r) => ({
                                id: r.id,
                                title: r.label.slice(0, 24),
                            })),
                        },
                    ],
                },
            },
        });
    }

    // #12 — a text message with optional media/text header and footer.
    async sendRichMessage(to: string, msg: RichMessage): Promise<void> {
        // A text-only header (or no header) with footer -> plain text message
        // with a "header"/"footer" component isn't supported for type:text, so
        // media headers require a media message; text header/footer fold in.
        if (msg.header && msg.header.type !== "text") {
            // Media message with caption as the body (WhatsApp shows caption
            // beneath the media). Footer isn't a native field here, so append.
            const mediaType = msg.header.type; // image | document | video
            const caption = [msg.body, msg.footer].filter(Boolean).join("\n");
            await this.post({
                messaging_product: "whatsapp",
                to,
                type: mediaType,
                [mediaType]: { link: msg.header.value, caption },
            });
            return;
        }

        // Text header/footer: WhatsApp text messages have no header/footer
        // fields, so compose them into the body text.
        const parts: string[] = [];
        if (msg.header?.type === "text") parts.push(msg.header.value);
        parts.push(msg.body);
        if (msg.footer) parts.push(msg.footer);
        await this.sendText(to, parts.join("\n"));
    }

    // #10 — a call-to-action URL button (interactive cta_url).
    async sendCtaUrl(to: string, text: string, buttonText: string, url: string, footer?: string): Promise<void> {
        await this.post({
            messaging_product: "whatsapp",
            to,
            type: "interactive",
            interactive: {
                type: "cta_url",
                body: { text },
                ...(footer ? { footer: { text: footer } } : {}),
                action: {
                    name: "cta_url",
                    parameters: {
                        display_text: buttonText.slice(0, 20),
                        url,
                    },
                },
            },
        });
    }
}