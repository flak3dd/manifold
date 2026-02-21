// @ts-nocheck
// (Node.js types resolve after `npm install` — @types/node and @types/ws are in devDependencies)

// ── Manifold scraper — Playwright + WebSocket server ──
//
// Run with:  npx tsx scripts/scraper.ts
//
// The frontend connects to ws://localhost:8765 and sends scrape requests.
// This script fulfils them using Playwright (with stealth) and sends results back.

import { WebSocketServer, WebSocket } from "ws";
import { chromium } from "playwright-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

// ── Types (mirrored from src/lib/types.ts) ────────────────────────────────────

interface WsScrapeRequest {
  type: "scrape";
  sourceId: string;
  url: string;
  selector: string;
}

interface WsPingMessage {
  type: "ping";
}

type WsClientMessage = WsScrapeRequest | WsPingMessage;

interface WsStatusMessage {
  type: "status";
  sourceId: string;
  status: "scraping";
}

interface WsResultMessage {
  type: "result";
  sourceId: string;
  content: string[];
  durationMs: number;
}

interface WsErrorMessage {
  type: "error";
  sourceId: string;
  message: string;
}

interface WsPongMessage {
  type: "pong";
}

type WsServerMessage =
  | WsStatusMessage
  | WsResultMessage
  | WsErrorMessage
  | WsPongMessage;

// ── Config ────────────────────────────────────────────────────────────────────

const PORT = 8765;
const MAX_BODY_LINES = 300; // max lines extracted when no selector given
const PAGE_TIMEOUT_MS = 30_000; // navigation timeout
const MAX_CONCURRENT = 4; // max simultaneous scrapes per client

// ── Setup stealth ─────────────────────────────────────────────────────────────

chromium.use(StealthPlugin());

// ── Helpers ───────────────────────────────────────────────────────────────────

function send(socket: WebSocket, msg: WsServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) {
    socket.send(JSON.stringify(msg));
  }
}

function log(label: string, ...args: unknown[]): void {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 23);
  console.log(`[${ts}] [${label}]`, ...args);
}

function cleanLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((l) =>
      l
        .replace(/\t/g, " ")
        .replace(/\s{2,}/g, " ")
        .trim(),
    )
    .filter((l) => l.length > 0);
}

// ── Core scrape function ──────────────────────────────────────────────────────

async function scrape(
  sourceId: string,
  url: string,
  selector: string,
  socket: WebSocket,
): Promise<void> {
  // Notify client that scraping has begun
  send(socket, { type: "status", sourceId, status: "scraping" });
  log("scrape", `START  ${url}  selector="${selector || "(none)"}"`);

  const t0 = Date.now();

  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
        "AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/124.0.0.0 Safari/537.36",
      viewport: { width: 1280, height: 800 },
      locale: "en-US",
      timezoneId: "America/New_York",
    });

    // Block unnecessary resource types to speed things up
    await context.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "media", "font", "stylesheet"].includes(type)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    const page = await context.newPage();

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: PAGE_TIMEOUT_MS,
    });

    // Brief wait for any JS-rendered content
    await page.waitForTimeout(800);

    let content: string[];

    if (selector.trim()) {
      // CSS selector mode — collect text from matched elements
      content = await page.evaluate((sel: string) => {
        const elements = Array.from(document.querySelectorAll(sel));
        return elements
          .map(
            (el) =>
              (el as HTMLElement).innerText?.trim() ??
              el.textContent?.trim() ??
              "",
          )
          .filter((t) => t.length > 0);
      }, selector.trim());
    } else {
      // Full body text mode — strip scripts/styles and extract visible text
      const raw = await page.evaluate(() => {
        // Remove script and style nodes before reading text
        const cloned = document.body.cloneNode(true) as HTMLElement;
        cloned
          .querySelectorAll("script, style, noscript, svg")
          .forEach((n) => n.remove());
        return cloned.innerText ?? cloned.textContent ?? "";
      });
      content = cleanLines(raw).slice(0, MAX_BODY_LINES);
    }

    const durationMs = Date.now() - t0;
    log("scrape", `DONE   ${url}  ${content.length} lines  ${durationMs}ms`);

    send(socket, { type: "result", sourceId, content, durationMs });
  } catch (err: unknown) {
    const durationMs = Date.now() - t0;
    const message = err instanceof Error ? err.message : String(err);
    log("scrape", `ERROR  ${url}  ${message}  ${durationMs}ms`);
    send(socket, { type: "error", sourceId, message });
  } finally {
    await browser.close();
  }
}

// ── WebSocket server ──────────────────────────────────────────────────────────

const wss = new WebSocketServer({ port: PORT });

log("server", `Manifold scraper listening on ws://localhost:${PORT}`);

wss.on("connection", (socket: WebSocket, req) => {
  const clientAddr = req.socket.remoteAddress ?? "unknown";
  log("connect", `Client connected  addr=${clientAddr}`);

  let activeScrapes = 0;
  const queue: (() => Promise<void>)[] = [];

  async function processQueue(): Promise<void> {
    while (queue.length > 0 && activeScrapes < MAX_CONCURRENT) {
      const task = queue.shift()!;
      activeScrapes++;
      task().finally(() => {
        activeScrapes--;
        processQueue();
      });
    }
  }

  function enqueue(req: WsScrapeRequest): void {
    queue.push(() => scrape(req.sourceId, req.url, req.selector, socket));
    processQueue();
  }

  socket.on("message", (data: Buffer | string) => {
    let msg: WsClientMessage;

    try {
      msg = JSON.parse(data.toString()) as WsClientMessage;
    } catch {
      log("warn", "Received non-JSON message, ignoring.");
      return;
    }

    if (msg.type === "ping") {
      send(socket, { type: "pong" });
      return;
    }

    if (msg.type === "scrape") {
      if (!msg.url) {
        send(socket, {
          type: "error",
          sourceId: msg.sourceId,
          message: "Missing required field: url",
        });
        return;
      }

      try {
        new URL(msg.url);
      } catch {
        send(socket, {
          type: "error",
          sourceId: msg.sourceId,
          message: `Invalid URL: "${msg.url}"`,
        });
        return;
      }

      enqueue(msg);
    }
  });

  socket.on("close", (code, reason) => {
    log(
      "disconnect",
      `Client disconnected  addr=${clientAddr}  code=${code}  reason=${reason.toString() || "(none)"}`,
    );
  });

  socket.on("error", (err) => {
    log("error", `Socket error  addr=${clientAddr}  ${err.message}`);
  });
});

wss.on("error", (err) => {
  log("fatal", `WebSocket server error: ${err.message}`);
  process.exit(1);
});

// ── Graceful shutdown ─────────────────────────────────────────────────────────

function shutdown(signal: string): void {
  log("shutdown", `Received ${signal}, closing server…`);
  wss.close(() => {
    log("shutdown", "Server closed.");
    process.exit(0);
  });
  // Force exit after 5 seconds if connections don't drain
  setTimeout(() => process.exit(0), 5000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
