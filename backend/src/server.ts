/**
 * server.ts — the entry point.
 *
 * app.ts builds the app; this file starts it listening on a port.
 * Keeping them separate makes testing easier (tests can import the
 * app without starting a real server).
 */
import { createApp } from "./app.js";
import { config } from "./infra/config.js";

const app = createApp();

app.listen(config.PORT, () => {
  console.log(`Backend running at http://localhost:${config.PORT}`);
  console.log(`Health check:      http://localhost:${config.PORT}/health`);
});
