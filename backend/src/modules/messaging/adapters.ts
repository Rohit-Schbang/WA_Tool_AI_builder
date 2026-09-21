import type { MessagingAdapter, MessageOption } from "../runtime/types.js";

// One recorded outgoing message. `options` is present for buttons/list
// so the test panel can render tappable choices.
export interface SentMessage {
    to: string;
    text: string;
    options?: MessageOption[];
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
}