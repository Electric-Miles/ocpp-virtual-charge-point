import { FastifyReply, FastifyRequest } from "fastify";
import {
  authorizeSession,
  cancelSession,
  commitSession,
  getTerminal,
  listTerminals,
  setCommitMode,
  setOnline,
  simulateTap,
  startSession,
  stopSession,
} from "../payter/payterStore";
import {
  PayterCommitModeRequestSchema,
  PayterOnlineRequestSchema,
  PayterTapRequestSchema,
} from "../schema";

// --- Raw endpoints mimicking Payter's own terminal API. These are what
// backendEM's PayterClient calls directly (PAYTER_BASE_URL pointed at this
// app), so they keep Payter's own path shapes and unwrapped response bodies,
// and are registered without JWT auth to match. ---

export const payterStart = async (
  request: FastifyRequest<{
    Params: { serial: string };
    Querystring: { authorizedAmount?: string; callbackUrl?: string; qr?: string };
  }>,
  reply: FastifyReply,
) => {
  const { serial } = request.params;
  const { authorizedAmount, callbackUrl, qr } = request.query;

  startSession(serial, {
    authorizedAmount: Number(authorizedAmount ?? 0),
    callbackUrl: callbackUrl ?? "",
    qr: qr ?? "",
  });

  return reply.send({});
};

export const payterAuthorize = async (
  request: FastifyRequest<{ Params: { serial: string } }>,
  reply: FastifyReply,
) => {
  return reply.send(authorizeSession(request.params.serial));
};

export const payterCommit = async (
  request: FastifyRequest<{
    Params: { serial: string; sessionId: string };
    Querystring: { commitAmount?: string };
  }>,
  reply: FastifyReply,
) => {
  const { serial, sessionId } = request.params;
  const commitAmount = Number(request.query.commitAmount ?? 0);

  const { statusCode, body } = commitSession(serial, sessionId, commitAmount);
  return reply.code(statusCode).send(body);
};

export const payterGetStatus = async (
  request: FastifyRequest<{ Params: { serial: string } }>,
  reply: FastifyReply,
) => {
  const terminal = getTerminal(request.params.serial);
  return reply.send({ online: terminal.online });
};

export const payterStop = async (
  request: FastifyRequest<{ Params: { terminalId: string } }>,
  reply: FastifyReply,
) => {
  return reply.send(stopSession(request.params.terminalId));
};

export const payterCancel = async (
  request: FastifyRequest<{ Params: { terminalId: string; sessionId: string } }>,
  reply: FastifyReply,
) => {
  const { terminalId, sessionId } = request.params;
  return reply.send(cancelSession(terminalId, sessionId));
};

// --- Admin endpoints for the control.html Payter tab. JWT-protected like the
// rest of /api/vcp/, unlike the raw endpoints above. ---

export const listPayterTerminals = async (
  _request: FastifyRequest,
  reply: FastifyReply,
) => {
  return reply.send({ status: "success", data: listTerminals() });
};

export const tapPayterCard = async (
  request: FastifyRequest<{
    Params: { serial: string };
    Body: PayterTapRequestSchema;
  }>,
  reply: FastifyReply,
) => {
  const { serial } = request.params;
  const { approved, maskedPan } = request.body;

  try {
    const session = await simulateTap(serial, { approved, maskedPan });
    return reply.send({ status: "success", data: session });
  } catch (e) {
    return reply.send({ status: "error", message: (e as Error).message });
  }
};

export const setPayterTerminalOnline = async (
  request: FastifyRequest<{
    Params: { serial: string };
    Body: PayterOnlineRequestSchema;
  }>,
  reply: FastifyReply,
) => {
  const { serial } = request.params;
  const terminal = setOnline(serial, request.body.online);
  return reply.send({ status: "success", data: terminal });
};

export const setPayterCommitMode = async (
  request: FastifyRequest<{
    Params: { serial: string };
    Body: PayterCommitModeRequestSchema;
  }>,
  reply: FastifyReply,
) => {
  const { serial } = request.params;
  const terminal = setCommitMode(serial, request.body.commitMode);
  return reply.send({ status: "success", data: terminal });
};
