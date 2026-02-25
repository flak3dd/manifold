// Live monitor for Manifold automation runs.
// Connects to the Playwright bridge WS (default :8766) and prints login_* events.

import WebSocket from "ws";

const BRIDGE_URL = process.env.MANIFOLD_BRIDGE_URL ?? "ws://localhost:8766";

function now() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

function safeJsonParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function brief(obj: any): string {
  if (!obj || typeof obj !== "object") return String(obj);
  const t = obj.type ?? "unknown";
  switch (t) {
    case "login_attempt_start":
      return `run=${obj.run_id} cred=${obj.credential_id ?? "?"} attempt=${obj.attempt_index ?? "?"}`;
    case "login_attempt_result": {
      const r = obj.result ?? {};
      return `run=${obj.run_id} cred=${r.credential_id ?? "?"} outcome=${r.outcome ?? "?"} detail=${String(r.detail ?? "").slice(0, 140)}`;
    }
    case "login_rotation": {
      const e = obj.event ?? {};
      return `run=${obj.run_id} ${e.rotation_type ?? "rotation"} ${e.reason ?? ""}`.trim();
    }
    case "login_fingerprint_rotation": {
      const e = obj.event ?? {};
      return `run=${obj.run_id} fp_rotate ${e.reason ?? ""}`.trim();
    }
    case "login_run_complete":
      return `run=${obj.run_id} complete`;
    case "login_run_paused":
      return `run=${obj.run_id} paused`;
    case "login_run_aborted":
      return `run=${obj.run_id} aborted`;
    case "login_error":
      return `run=${obj.run_id} ERROR ${String(obj.message ?? "").slice(0, 200)}`;
    default:
      return t;
  }
}

function shouldPrint(msg: any): boolean {
  if (!msg || typeof msg !== "object") return false;
  const t = msg.type;
  if (typeof t !== "string") return false;
  // Print everything except heartbeat noise so we can confirm we're on the
  // same bridge instance that the app uses.
  if (t === "pong") return false;
  return true;
}

function connect() {
  console.log(`[${now()}] [monitor] connecting ${BRIDGE_URL}`);
  const ws = new WebSocket(BRIDGE_URL);

  ws.on("open", () => {
    console.log(`[${now()}] [monitor] connected`);
  });

  ws.on("message", (data) => {
    const raw = typeof data === "string" ? data : data.toString();
    const msg = safeJsonParse(raw) ?? { type: "unknown", raw };
    if (!shouldPrint(msg)) return;
    console.log(`[${now()}] ${brief(msg)}`);
  });

  ws.on("close", (code, reason) => {
    console.log(
      `[${now()}] [monitor] disconnected code=${code} reason=${String(reason || "").slice(0, 120)}`,
    );
    setTimeout(connect, 1000).unref();
  });

  ws.on("error", (err) => {
    console.log(`[${now()}] [monitor] ws error: ${String(err).slice(0, 200)}`);
  });
}

connect();

