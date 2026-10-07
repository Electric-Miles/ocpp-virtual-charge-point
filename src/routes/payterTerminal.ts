import { FastifyInstance } from "fastify";
import {
  payterAuthorize,
  payterCancel,
  payterCommit,
  payterGetStatus,
  payterStart,
  payterStop,
} from "../controllers/payterController";

/**
 * Mirrors Payter's own terminal API paths exactly (no /api prefix, no auth)
 * so backendEM's PayterClient can point PAYTER_BASE_URL at this app and call
 * it exactly as it would call the real Payter platform. Deliberately does
 * not enforce Payter's Authorization header scheme.
 */
export async function payterTerminalRoutes(app: FastifyInstance) {
  // PayterClient always sends a null body but still sets
  // Content-Type: application/json (it puts request params in the query
  // string instead). Fastify's default JSON parser rejects an empty body
  // for that content type, so relax it just for these routes.
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, body, done) => {
      if (!body) {
        done(null, undefined);
        return;
      }
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    },
  );

  app.post("/terminals/:serial/start", payterStart);
  app.post("/terminals/:serial/authorize", payterAuthorize);
  app.post("/terminals/:serial/sessions/:sessionId/commit", payterCommit);
  app.get("/terminals/:serial", payterGetStatus);
  app.post("/terminals/:terminalId/stop", payterStop);
  app.post("/terminals/:terminalId/sessions/:sessionId/cancel", payterCancel);
}
