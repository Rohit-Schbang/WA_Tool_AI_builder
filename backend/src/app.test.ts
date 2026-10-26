import { test, describe, after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { createApp } from "./app.js";

// Real app on a random local port. These requests never reach a route handler
// or the database: the body parser rejects them first.
let server: Server;
let base = "";

before(async () => {
  server = createApp().listen(0);
  await new Promise<void>((r) => server.once("listening", () => r()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((r) => server.close(() => r())));

describe("request body errors are client errors, not 500s", () => {
  test("a blank 'JSON' body (the Postman case) returns 400 INVALID_JSON", async () => {
    const res = await fetch(`${base}/api/chatbots/x/connection/health`, {
      method: "POST", // fetch can't send a GET body; the parser runs before routing either way
      headers: { "Content-Type": "application/json" },
      body: "\n\n\n\n\n\n\n\n\n",
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "INVALID_JSON");
  });

  test("malformed JSON returns 400", async () => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ email: ",
    });
    assert.equal(res.status, 400);
  });

  test("an over-size body keeps its 413", async () => {
    const res = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ blob: "x".repeat(7 * 1024 * 1024) }),
    });
    assert.equal(res.status, 413);
  });
});
