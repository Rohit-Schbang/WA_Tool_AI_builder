# Keeping the backend awake on Render (free tier)

Render's free web services **spin down after ~15 minutes of inactivity**. The
next request then triggers a **cold start (30–60s)**, which can delay or even
miss the first WhatsApp webhook. To avoid this, an external cron pings a
lightweight endpoint on a short interval so the service never goes idle.

## 1. The ping endpoint (already built)

```
GET https://<your-service>.onrender.com/ping
→ 200 { "ok": true, "uptime": 1234.5 }
```

- No database, no auth — just returns 200 instantly.
- It sits **above** the `/api` rate limiter, so the pinger is never throttled.
- Prefer `/ping` over `/health` for the keep-alive (health may do more work
  later); either returns 200 and will keep the service warm.

## 2. Set up an external cron (free, no code)

Render's own Cron Jobs are a **paid** feature, and a sleeping free service
can't wake itself — so the pinger must be **external**. Use either of these
free services.

### Option A — cron-job.org (recommended)
1. Create a free account at https://cron-job.org
2. **Create cronjob** →
   - **URL**: `https://<your-service>.onrender.com/ping`
   - **Schedule**: every **10 minutes** (`*/10 * * * *`)
   - **Request method**: GET
   - Enable "Save responses" if you want a log.
3. Save. Done.

### Option B — UptimeRobot
1. Create a free account at https://uptimerobot.com
2. **Add New Monitor** →
   - **Monitor type**: HTTP(s)
   - **URL**: `https://<your-service>.onrender.com/ping`
   - **Monitoring interval**: **5 minutes** (UptimeRobot's free minimum)
3. Create. It also gives you uptime stats + downtime alerts for free.

### Why 10 minutes?
Render sleeps after ~15 min idle, so any interval **under 15 minutes** keeps it
warm. 10 min is a safe margin with low request volume (~4,320 pings/month).

## 3. Notes & caveats

- **This does not stop the first-ever cold start** after a deploy — only idle
  spin-downs. That's expected.
- Keeping a free instance always-on uses its monthly free compute hours faster.
  If the service must be guaranteed warm 24/7 (production WhatsApp traffic), the
  paid Starter plan (no spin-down) is the real fix; the pinger is a free-tier
  workaround.
- The WhatsApp **webhook** itself is a form of keep-alive too — every inbound
  message wakes/keeps the service up. The cron just covers quiet periods.
- Point the cron at the **deployed Render URL**, not localhost.
