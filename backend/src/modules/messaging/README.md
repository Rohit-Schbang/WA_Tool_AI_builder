# Messaging module

Channel-agnostic messaging abstraction (ADR-007).

The runtime engine calls a `MessagingAdapter` interface — "send a message to
the user" — without knowing the channel. The WhatsApp adapter implements this
interface by calling the Meta Cloud API.

This is what lets us add SMS / Telegram / Web Chat later without touching the
workflow engine.

Implemented in Phase 4. No HTTP routes here — it's internal engine code.
