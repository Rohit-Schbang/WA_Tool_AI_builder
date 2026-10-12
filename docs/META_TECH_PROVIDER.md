# Becoming a WhatsApp Tech Provider (how PingFlow works like Gupshup / BIK.ai / Wati)

This is the **one-time vendor setup** that turns the working "Connect to Meta"
button into a real platform your customers can self-onboard onto — exactly how
Gupshup, BIK.ai, Wati and Interakt do it.

> **Read this first — the mental model**
>
> There are **two** sets of Meta credentials, owned by two different people:
>
> | Credential | Owner | Set how often | Seen by customers? |
> |---|---|---|---|
> | App ID / App Secret / Config ID / Solution ID | **You (the vendor)** | Once, before launch | No — live in your server `.env` |
> | WhatsApp Business account (WABA) + phone number | **Each customer** | Per signup, via the button | Yes — they log into their own |
>
> This is identical to "Sign in with Google": the developer registers **one**
> OAuth client; every end user just clicks the button and logs into their own
> Google account. Your customers never touch Meta credentials. The whole
> Embedded Signup flow (already built in this app) exists so a non-technical
> customer clicks one button and is connected in minutes.

The code side is **done**. What remains is a business/account process on Meta's
side that only you (the vendor) can complete. No amount of code can replace it —
Meta only renders its login page and lets strangers connect once your app is a
registered, reviewed Tech Provider app.

---

## What you get at the end

- One Meta app (App ID + App Secret) that belongs to your business.
- A **Facebook Login for Business** configuration (Config ID) wired to the
  WhatsApp Embedded Signup use case.
- **Advanced Access** to `whatsapp_business_management` and
  `whatsapp_business_messaging` so *any* business (not just your test accounts)
  can connect.
- (Optional but recommended) **Tech Provider / Solution Partner** status and a
  **Solution ID** so onboarded accounts are attributed to your platform.

Paste the resulting values into `backend/.env`, restart the backend, and the
"Connect to Meta" button becomes fully live.

---

## Step-by-step

### 1. Create a Meta Business Portfolio (if you don't have one)
Go to [business.facebook.com](https://business.facebook.com) → create a Business
portfolio for your company. Complete **Business Verification** (legal name,
address, website, phone). Verification is required before your app can serve the
public and before you can send at scale.

### 2. Create the Meta app
1. Go to [developers.facebook.com/apps](https://developers.facebook.com/apps) →
   **Create App**.
2. App type: choose **Business**.
3. Link it to the Business portfolio from step 1.
4. Add the **WhatsApp** product to the app.

Then open **App Settings → Basic**:
- Copy the **App ID** → this is `META_APP_ID`.
- Copy the **App Secret** → this is `META_APP_SECRET` (backend-only, never expose).
- Add your site under **App Domains** / allowed domains: `http://localhost:3000`
  for dev (your `FRONTEND_ORIGIN`), and your production domain later.

### 3. Create the Facebook Login for Business configuration
1. In the app, add **Facebook Login for Business**.
2. Go to **Configurations → Create configuration**.
3. Choose the **WhatsApp Embedded Signup** use case.
4. Request the permissions `whatsapp_business_management` and
   `whatsapp_business_messaging`.
5. Save and copy the **Configuration ID** → this is `META_CONFIG_ID`.

### 4. (Recommended) Become a Tech Provider / get a Solution ID
To onboard other businesses under your platform (the BSP model), apply for
**Tech Provider** access for WhatsApp. Once granted you can create a
**Solution**, whose id becomes `META_SOLUTION_ID`. The app already passes this
into the signup popup (`extras.setup.solutionID`) when set, so onboarded WABAs
are attributed to you.

### 5. Submit for App Review (Advanced Access)
Until this is approved, **only Meta accounts you add as testers** can connect
(App Settings → Roles → add testers). This is Meta's rule for everyone — Gupshup
started here too.

Submit **App Review** requesting **Advanced Access** for:
- `whatsapp_business_management`
- `whatsapp_business_messaging`

You'll record a screencast of the Embedded Signup flow and describe your use
case. After approval, the public can connect.

### 6. Configure the webhook
In **WhatsApp → Configuration**, set:
- **Callback URL**: `https://<your-backend-domain>/api/whatsapp/webhook`
  (the Settings page shows this exact URL and lets you copy it).
- **Verify token**: any string you choose; store the same value so the webhook
  verification handshake passes.
- Subscribe to the `messages` field.

> The app auto-subscribes each customer's WABA to your app during signup
> (`subscribed_apps`), so per-customer webhook wiring is automatic. This step is
> the one-time app-level webhook.

### 7. Paste the values and restart
In `backend/.env`:

```dotenv
META_APP_ID=<your real app id>
META_APP_SECRET=<your real app secret>
META_CONFIG_ID=<your Login-for-Business configuration id>
META_SOLUTION_ID=<your solution id, if you have one>   # optional
META_GRAPH_VERSION=v22.0
WHATSAPP_REGISTER_PIN=<a 6-digit pin you choose>
```

Then **fully restart the backend** (dotenv reads `.env` only once at boot; a
hot-reload is not enough):

```powershell
# stop the running dev server, then:
npm run dev
```

Verify: open a chatbot's **WhatsApp Settings**. The "Connect to Meta" button
should be enabled (not the "not enabled on this server" card). Clicking it now
loads Meta's **real** hosted login page instead of "Invalid app ID".

---

## What the app already does for you (no action needed)

Once the credentials above are real, each time a customer clicks **Connect to
Meta**, the backend automatically:

1. Exchanges the returned code for a Business Integration System User token.
2. Reads the WABA name + phone number for display.
3. **Subscribes** your app to the customer's WABA webhooks (and verifies it).
4. **Registers** the customer's phone number for the Cloud API and sets its
   two-step-verification PIN.
5. Persists the connection (per chatbot) and marks it `CONNECTED`.

The customer does none of this — they only log in and pick their number. That is
the Gupshup / BIK.ai experience.

---

## Going to production (checklist)

- [ ] Business verification complete.
- [ ] App Review approved with Advanced Access for both WhatsApp permissions.
- [ ] Credentials stored as **real environment variables** on your host (not
      committed to git). `backend/src/infra/config.ts` already reads them from
      the environment.
- [ ] Production webhook URL (HTTPS) configured and reachable.
- [ ] `FRONTEND_ORIGIN` / App Domains updated to your production domain.
- [ ] Consider **display name review** for each customer number and monitor
      **quality rating** (surfaced via `getPhoneStatus`).

## Reference
- WhatsApp Embedded Signup:
  https://developers.facebook.com/docs/whatsapp/embedded-signup
- Cloud API get started:
  https://developers.facebook.com/docs/whatsapp/cloud-api/get-started

_Content summarizes Meta's public developer documentation; steps may shift as
Meta updates its dashboard. Rephrased for this project._
