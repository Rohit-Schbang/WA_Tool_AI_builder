/**
 * Central config loader.
 *
 * We read environment variables ONCE here and validate them with Zod.
 * Every other file imports `config` from here instead of touching
 * process.env directly. If a required variable is missing, the app
 * fails fast on startup with a clear error — much better than a
 * confusing crash deep in the code later.
 */
import dotenv from "dotenv";
import { z } from "zod";

// Load variables from the .env file into process.env
dotenv.config();

// Describe the shape we expect. Zod will parse + validate process.env.
const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  JWT_SECRET: z.string().min(1, "JWT_SECRET is required"),
  JWT_EXPIRES_IN: z.string().default("7d"),
  FRONTEND_ORIGIN: z.string().default("http://localhost:3001"),
  GEMINI_API_KEY: z.string().optional(),

  // --- WhatsApp Embedded Signup (Meta) ---
  // All optional so the app boots without them; the embedded-signup flow is
  // simply disabled until the manager provides these from the Meta App
  // dashboard. APP_ID + CONFIG_ID are safe to expose to the frontend (for the
  // FB JS SDK); APP_SECRET is backend-only.
  META_APP_ID: z.string().optional(),
  META_APP_SECRET: z.string().optional(),
  META_CONFIG_ID: z.string().optional(),          // Facebook Login for Business Configuration ID
  META_GRAPH_VERSION: z.string().default("v22.0"),
  META_REDIRECT_URI: z.string().optional(),        // must match a registered OAuth redirect URI
  WHATSAPP_REGISTER_PIN: z.string().default("000000"), // 6-digit PIN used when registering the phone number
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Print a readable list of what's wrong and stop the process.
  console.error("Invalid environment configuration:");
  console.error(parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const config = parsed.data;
