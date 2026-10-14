import rateLimit from "express-rate-limit";

// API rate limiter: 100 requests per minute, per client IP.
//
// Applied to the JSON API routes (auth, chatbots, contacts, workflows,
// conversations, connection). The Meta webhook is intentionally NOT rate
// limited — Meta can deliver inbound messages in bursts, and dropping them
// would silently lose real customer messages; the webhook is secured by HMAC
// signature verification instead.
//
// Standard draft-7 RateLimit-* headers are returned so clients can see their
// remaining quota; the legacy X-RateLimit-* headers are disabled.
export const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 100,          // max requests per window per IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests. Please slow down and try again shortly." },
});
