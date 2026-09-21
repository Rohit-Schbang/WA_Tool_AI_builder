import { prisma } from "../../infra/prisma.js";
import type { MessagingAdapter, MessageOption } from "../runtime/types.js";

// Wraps a real MessagingAdapter and logs every outbound message to the DB
// (as an OUTBOUND Message row) before delegating to the wrapped adapter.
export class LoggingAdapter implements MessagingAdapter {
  constructor(
    private inner: MessagingAdapter,
    private conversationId: string
  ) {}

  private async log(messageType: string, content: any) {
    await prisma.message.create({
      data: {
        conversationId: this.conversationId,
        direction: "OUTBOUND",
        messageType,
        content,
      },
    });
  }

  async sendText(to: string, text: string): Promise<void> {
    await this.log("text", { text });
    await this.inner.sendText(to, text);
  }

  async sendButtons(to: string, text: string, buttons: MessageOption[]): Promise<void> {
    await this.log("button", { text, buttons });
    if (this.inner.sendButtons) {
      await this.inner.sendButtons(to, text, buttons);
    } else {
      await this.inner.sendText(to, text);
    }
  }

  async sendList(to: string, text: string, buttonText: string, rows: MessageOption[]): Promise<void> {
    await this.log("list", { text, buttonText, rows });
    if (this.inner.sendList) {
      await this.inner.sendList(to, text, buttonText, rows);
    } else {
      await this.inner.sendText(to, text);
    }
  }
}
