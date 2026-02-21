// ── Manifold WebSocket client ──

import type { WsClientMessage, WsServerMessage } from './types';

type ServerMessageHandler = (msg: WsServerMessage) => void;
type ConnectChangeHandler = (connected: boolean) => void;

const WS_URL = 'ws://localhost:8765';
const RECONNECT_DELAY_MS = 3000;

class WebSocketClient {
  private socket: WebSocket | null = null;
  private messageHandlers: Set<ServerMessageHandler> = new Set();
  private connectHandlers: Set<ConnectChangeHandler> = new Set();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private url = WS_URL;

  // ── Public state ──────────────────────────────────────────────────────────

  connected = false;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  connect(url = WS_URL) {
    this.url = url;
    this.destroyed = false;
    this._open();
  }

  disconnect() {
    this.destroyed = true;
    this._clearReconnect();
    this.socket?.close();
    this.socket = null;
  }

  // ── Sending ───────────────────────────────────────────────────────────────

  send(msg: WsClientMessage): boolean {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
      return true;
    }
    return false;
  }

  // ── Subscriptions ─────────────────────────────────────────────────────────

  /** Register a handler for messages arriving from the server. */
  onMessage(handler: ServerMessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  /** Register a handler that fires whenever the connection state changes. */
  onConnectChange(handler: ConnectChangeHandler): () => void {
    this.connectHandlers.add(handler);
    return () => this.connectHandlers.delete(handler);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _open() {
    if (this.destroyed) return;

    try {
      const socket = new WebSocket(this.url);
      this.socket = socket;

      socket.onopen = () => {
        if (socket !== this.socket) return; // stale
        this._clearReconnect();
        this._setConnected(true);
      };

      socket.onmessage = (event: MessageEvent) => {
        if (socket !== this.socket) return;
        try {
          const msg = JSON.parse(event.data as string) as WsServerMessage;
          this.messageHandlers.forEach(h => h(msg));
        } catch {
          // ignore malformed frames
        }
      };

      socket.onerror = () => {
        // onerror is always followed by onclose — let onclose handle cleanup
      };

      socket.onclose = () => {
        if (socket !== this.socket) return;
        this._setConnected(false);
        this._scheduleReconnect();
      };
    } catch {
      this._setConnected(false);
      this._scheduleReconnect();
    }
  }

  private _setConnected(value: boolean) {
    if (this.connected === value) return;
    this.connected = value;
    this.connectHandlers.forEach(h => h(value));
  }

  private _scheduleReconnect() {
    if (this.destroyed || this.reconnectTimer !== null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._open();
    }, RECONNECT_DELAY_MS);
  }

  private _clearReconnect() {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }
}

// Singleton — import `ws` anywhere in the frontend.
export const ws = new WebSocketClient();
