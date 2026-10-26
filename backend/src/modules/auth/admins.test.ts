import { test } from "node:test";
import assert from "node:assert/strict";
import { isSettingsAdmin } from "./admins.js";

test("settings access: only the listed emails", () => {
  for (const e of ["aman.singh@schbang.com", "deeraj.rajesh@schbang.com", "khushi.saxena@schbang.com", "rohit.sawant@schbang.com"]) {
    assert.equal(isSettingsAdmin(e), true, e);
  }
  assert.equal(isSettingsAdmin("  Aman.Singh@Schbang.com "), true); // case/whitespace-insensitive
  assert.equal(isSettingsAdmin("someone.else@schbang.com"), false);
  assert.equal(isSettingsAdmin("aman.singh@schbang.com.evil.com"), false);
  assert.equal(isSettingsAdmin("xaman.singh@schbang.com"), false);
  assert.equal(isSettingsAdmin(""), false);
  assert.equal(isSettingsAdmin(undefined), false);
});
