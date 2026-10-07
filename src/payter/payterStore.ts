import { v4 as uuid } from "uuid";

export type PayterSessionStatus =
  | "awaiting_card"
  | "authorized"
  | "declined"
  | "committed"
  | "commit_failed"
  | "cancelled"
  | "stopped";

/**
 * How the emulated terminal answers the next commit request(s), so the backend's
 * failure handling can be exercised. Mirrors the outcomes in Payter's OpenAPI
 * spec for POST /terminals/{serial}/sessions/{sessionId}/commit:
 * - success:  200, Session with state COMMITED
 * - failed:   200, Session with state FAILED
 * - conflict: 409, GlobalExceptionResult ("Session already committed or cancelled")
 * - error:    500, GlobalExceptionResult ("General error")
 */
export type PayterCommitMode = "success" | "failed" | "conflict" | "error";

export const PAYTER_COMMIT_MODES: PayterCommitMode[] = [
  "success",
  "failed",
  "conflict",
  "error",
];

export interface PayterSession {
  sessionId: string | null;
  authorizedAmount: number;
  callbackUrl: string;
  qr: string;
  status: PayterSessionStatus;
  terminalTxnId: number | null;
  maskedPan: string | null;
  card: PayterCardDetails | null;
  commitAmount: number | null;
  commitTime: number | null;
  callbackResult: string | null;
  lastCommitResponse: { statusCode: number; body: unknown } | null;
  createdAt: number;
  updatedAt: number;
}

/** Card / EMV details the terminal records once a card is approved. */
export interface PayterCardDetails {
  transactionTime: string;
  cardId: string;
  brand: string;
  emvDate: string;
  emvTime: string;
  authorizationResponseCode: string;
  authorizationCode: string;
  authorizationHostReference: string;
  merchantReference: string;
}

export interface PayterTerminal {
  serial: string;
  online: boolean;
  commitMode: PayterCommitMode;
  session: PayterSession | null;
}

const terminals = new Map<string, PayterTerminal>();
let terminalTxnCounter = 1000;

export function getTerminal(serial: string): PayterTerminal {
  let terminal = terminals.get(serial);
  if (!terminal) {
    terminal = { serial, online: true, commitMode: "success", session: null };
    terminals.set(serial, terminal);
  }
  return terminal;
}

export function listTerminals(): PayterTerminal[] {
  return [...terminals.values()];
}

export function setOnline(serial: string, online: boolean): PayterTerminal {
  const terminal = getTerminal(serial);
  terminal.online = online;
  return terminal;
}

export function setCommitMode(
  serial: string,
  commitMode: PayterCommitMode,
): PayterTerminal {
  const terminal = getTerminal(serial);
  terminal.commitMode = commitMode;
  return terminal;
}

export function startSession(
  serial: string,
  data: { authorizedAmount: number; callbackUrl: string; qr: string },
): PayterSession {
  const terminal = getTerminal(serial);
  const now = Date.now();
  terminal.session = {
    sessionId: null,
    authorizedAmount: data.authorizedAmount,
    callbackUrl: data.callbackUrl,
    qr: data.qr,
    status: "awaiting_card",
    terminalTxnId: null,
    maskedPan: null,
    card: null,
    commitAmount: null,
    commitTime: null,
    callbackResult: null,
    lastCommitResponse: null,
    createdAt: now,
    updatedAt: now,
  };
  return terminal.session;
}

/**
 * Simulates a customer presenting (or declining to present) their card at the
 * terminal. Sets the outcome locally first, then POSTs to the callbackUrl the
 * backend gave us in /start - mirroring a real Payter terminal, which reports
 * outcome via callback before the backend calls back into /authorize.
 */
export async function simulateTap(
  serial: string,
  { approved, maskedPan }: { approved: boolean; maskedPan?: string },
): Promise<PayterSession> {
  const terminal = getTerminal(serial);
  const session = terminal.session;
  if (!session) {
    throw new Error(`No pending session for terminal ${serial}`);
  }

  session.status = approved ? "authorized" : "declined";
  session.maskedPan = maskedPan || "512345******1234";
  session.updatedAt = Date.now();

  if (approved) {
    session.sessionId = uuid();
    session.terminalTxnId = terminalTxnCounter++;
    session.card = fakeCardDetails(session.sessionId, session.updatedAt);
  }

  if (session.callbackUrl) {
    try {
      const res = await fetch(session.callbackUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: session.sessionId,
          maskedPan: session.maskedPan,
        }),
      });
      session.callbackResult = `${res.status} ${res.statusText}`;
    } catch (e) {
      session.callbackResult = `error: ${(e as Error).message}`;
    }
  } else {
    session.callbackResult = "no callbackUrl on session (was not started via /start)";
  }

  return session;
}

export function authorizeSession(serial: string): {
  state: string;
  result: string;
  sessionId?: string | null;
  authorizedAmount?: number;
  terminalTxnId?: number | null;
} {
  const terminal = getTerminal(serial);
  const session = terminal.session;

  if (session && session.status === "authorized") {
    return {
      state: "AUTHORIZED",
      result: "APPROVED",
      sessionId: session.sessionId,
      authorizedAmount: session.authorizedAmount,
      terminalTxnId: session.terminalTxnId,
    };
  }

  return {
    state: session?.status === "declined" ? "DECLINED" : "FAILED",
    result: "DECLINED",
  };
}

function randomHex(bytes: number): string {
  return [...Array(bytes * 2)]
    .map(() => Math.floor(Math.random() * 16).toString(16))
    .join("")
    .toUpperCase();
}

function fakeCardDetails(sessionId: string, time: number): PayterCardDetails {
  const iso = new Date(time).toISOString(); // 2026-07-02T11:52:22.000Z
  const authCode = String(Math.floor(10000000 + Math.random() * 90000000));
  return {
    transactionTime: iso.replace("Z", ""),
    cardId: randomHex(32),
    brand: "A0000000041010", // Mastercard AID
    emvDate: iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10),
    emvTime: iso.slice(11, 13) + iso.slice(14, 16) + iso.slice(17, 19),
    authorizationResponseCode: "00",
    authorizationCode: authCode,
    authorizationHostReference: `17${authCode}${Date.now() % 1_000_000_000}`,
    merchantReference: sessionId.replace(/-/g, ""),
  };
}

/** Builds Payter's `Session` response body, as returned by commit/cancel/stop. */
function sessionBody(
  serial: string,
  session: PayterSession | null,
  sessionId: string,
  state: "AUTHORIZED" | "COMMITED" | "CANCELLED" | "FAILED",
  commitTime: number,
) {
  // `result` is the EMV result of the card tap, so it stays APPROVED even when
  // the commit itself fails - only `state` reflects the commit outcome.
  const approved = !!session?.card && session.status !== "declined";
  return {
    serialNumber: serial,
    sessionId: session?.sessionId ?? sessionId,
    cardId: session?.card?.cardId ?? null,
    transactionTime: session?.card?.transactionTime ?? null,
    commitTime: new Date(commitTime).toISOString().replace("Z", "+0000"),
    brand: session?.card?.brand ?? null,
    emvDate: session?.card?.emvDate ?? null,
    emvTime: session?.card?.emvTime ?? null,
    authorizedAmount: session?.authorizedAmount ?? 0,
    ...(state === "COMMITED" || state === "FAILED"
      ? { finalAmount: session?.commitAmount ?? 0 }
      : {}),
    result: approved ? "APPROVED" : "DECLINED",
    authorizationResponseCode: session?.card?.authorizationResponseCode ?? null,
    authorizationCode: session?.card?.authorizationCode ?? null,
    authorizationHostReference:
      session?.card?.authorizationHostReference ?? null,
    terminalTxnId: session?.terminalTxnId ?? null,
    merchantReference: session?.card?.merchantReference ?? null,
    receiptInfo: [],
    state,
  };
}

/** Payter's `GlobalExceptionResult` error body. */
function errorBody(status: number, error: string, message: string) {
  return { timestamp: new Date().toISOString(), status, error, message };
}

export function commitSession(
  serial: string,
  sessionId: string,
  commitAmount: number,
): { statusCode: number; body: unknown } {
  const terminal = getTerminal(serial);
  const session = terminal.session;

  if (!session || session.sessionId !== sessionId) {
    return {
      statusCode: 404,
      body: errorBody(404, "Not Found", `Session ${sessionId} not found`),
    };
  }

  const now = Date.now();
  let response: { statusCode: number; body: unknown };

  if (
    session.status === "committed" ||
    session.status === "cancelled" ||
    session.status === "stopped"
  ) {
    response = {
      statusCode: 409,
      body: errorBody(409, "Conflict", "Session already committed or cancelled"),
    };
  } else if (terminal.commitMode === "conflict") {
    response = {
      statusCode: 409,
      body: errorBody(409, "Conflict", "Session already committed or cancelled"),
    };
  } else if (terminal.commitMode === "error") {
    response = {
      statusCode: 500,
      body: errorBody(500, "Internal Server Error", "Commit failed (simulated)"),
    };
  } else {
    const failed = terminal.commitMode === "failed";
    session.status = failed ? "commit_failed" : "committed";
    session.commitAmount = commitAmount;
    session.commitTime = now;
    response = {
      statusCode: 200,
      body: sessionBody(serial, session, sessionId, failed ? "FAILED" : "COMMITED", now),
    };
  }

  session.lastCommitResponse = response;
  session.updatedAt = now;
  return response;
}

export function cancelSession(terminalId: string, sessionId: string) {
  const terminal = getTerminal(terminalId);
  const session = terminal.session;
  const response = sessionBody(terminalId, session, sessionId, "CANCELLED", Date.now());

  if (session) {
    session.status = "cancelled";
    session.updatedAt = Date.now();
  }

  return response;
}

export function stopSession(terminalId: string) {
  const terminal = getTerminal(terminalId);
  const session = terminal.session;
  const response = sessionBody(
    terminalId,
    session,
    session?.sessionId ?? "",
    "CANCELLED",
    Date.now(),
  );

  if (session) {
    session.status = "stopped";
    session.updatedAt = Date.now();
  }

  return response;
}
