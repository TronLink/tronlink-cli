import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SERVE_DIR = path.join(os.homedir(), '.tronlink-cli');
const SERVE_STATE_FILE = path.join(SERVE_DIR, 'serve.json');
const SERVE_LOCK_FILE = path.join(SERVE_DIR, 'serve.lock');
const SOCKET_PATH = path.join(SERVE_DIR, 'serve.sock');

interface ServeState {
  pid: number;
  port: number;
  startedAt: string;
}

// ─── State file ───

export function writeServeState(port: number): void {
  if (!fs.existsSync(SERVE_DIR)) {
    fs.mkdirSync(SERVE_DIR, { recursive: true });
  }
  const state: ServeState = { pid: process.pid, port, startedAt: new Date().toISOString() };
  fs.writeFileSync(SERVE_STATE_FILE, JSON.stringify(state, null, 2));
}

export function readServeState(): ServeState | null {
  try {
    if (!fs.existsSync(SERVE_STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(SERVE_STATE_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

export function clearServeState(): void {
  try { fs.unlinkSync(SERVE_STATE_FILE); } catch { /* ignore */ }
  try { fs.unlinkSync(SOCKET_PATH); } catch { /* ignore */ }
  try { fs.unlinkSync(SERVE_LOCK_FILE); } catch { /* ignore */ }
}

/**
 * Acquire an exclusive lock to prevent concurrent serve starts.
 * Returns a release function, or null if lock is held by another process.
 */
export function acquireServeLock(): (() => void) | null {
  if (!fs.existsSync(SERVE_DIR)) {
    fs.mkdirSync(SERVE_DIR, { recursive: true });
  }
  try {
    const fd = fs.openSync(SERVE_LOCK_FILE, 'wx');
    fs.writeSync(fd, String(process.pid));
    fs.closeSync(fd);
    return () => {
      try { fs.unlinkSync(SERVE_LOCK_FILE); } catch { /* ignore */ }
    };
  } catch {
    // Lock file exists — check if the holder is still alive
    try {
      const pid = parseInt(fs.readFileSync(SERVE_LOCK_FILE, 'utf-8'), 10);
      process.kill(pid, 0); // throws if dead
      return null; // another process holds the lock
    } catch {
      // Stale lock — remove and retry
      try { fs.unlinkSync(SERVE_LOCK_FILE); } catch { /* ignore */ }
      try {
        const fd = fs.openSync(SERVE_LOCK_FILE, 'wx');
        fs.writeSync(fd, String(process.pid));
        fs.closeSync(fd);
        return () => {
          try { fs.unlinkSync(SERVE_LOCK_FILE); } catch { /* ignore */ }
        };
      } catch {
        return null;
      }
    }
  }
}

// ─── IPC Server (used by `tronlink serve`) ───

export type RequestHandler = (
  method: string,
  params: Record<string, unknown>,
  signal: AbortSignal,
) => Promise<unknown>;

export function startIPCServer(handler: RequestHandler): net.Server {
  try { fs.unlinkSync(SOCKET_PATH); } catch { /* ignore */ }

  const server = net.createServer((conn) => {
    let buffer = '';
    // AbortControllers for in-flight operations on this connection
    const activeAborts = new Set<AbortController>();

    // Suppress socket errors (e.g. EPIPE when writing to closed connection)
    conn.on('error', () => {});

    conn.on('data', (chunk) => {
      buffer += chunk.toString();
      let idx: number;
      while ((idx = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        handleMessage(conn, line, handler, activeAborts);
      }
    });

    conn.on('close', () => {
      // CLI disconnected — abort all in-flight signer operations
      for (const controller of activeAborts) {
        controller.abort();
      }
      activeAborts.clear();
    });
  });

  server.listen(SOCKET_PATH);
  return server;
}

function handleMessage(
  conn: net.Socket,
  raw: string,
  handler: RequestHandler,
  activeAborts: Set<AbortController>,
): void {
  let msg: { id: number; method: string; params?: Record<string, unknown> };
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }

  const controller = new AbortController();
  activeAborts.add(controller);

  handler(msg.method, msg.params || {}, controller.signal)
    .then((result) => {
      activeAborts.delete(controller);
      if (!conn.destroyed) {
        conn.write(JSON.stringify({ id: msg.id, result }) + '\n');
      }
    })
    .catch((err) => {
      activeAborts.delete(controller);
      if (!conn.destroyed) {
        conn.write(JSON.stringify({ id: msg.id, error: err instanceof Error ? err.message : String(err) }) + '\n');
      }
    });
}

// ─── IPC Client (used by other commands) ───

export async function tryConnectIPC(): Promise<IPCClient | null> {
  const state = readServeState();
  if (!state) return null;

  try {
    process.kill(state.pid, 0);
  } catch {
    clearServeState();
    return null;
  }

  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        conn.destroy();
        resolve(null);
      }
    }, 1000);
    const conn = net.createConnection(SOCKET_PATH, () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(new IPCClient(conn));
      }
    });
    conn.on('error', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        clearServeState();
        resolve(null);
      }
    });
  });
}

export class IPCClient {
  private conn: net.Socket;
  private nextId = 1;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private buffer = '';

  constructor(conn: net.Socket) {
    this.conn = conn;
    conn.on('data', (chunk) => {
      this.buffer += chunk.toString();
      let idx: number;
      while ((idx = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        this.handleResponse(line);
      }
    });
    conn.on('error', () => this.rejectAll('IPC connection lost'));
    conn.on('close', () => this.rejectAll('IPC connection closed'));
  }

  private handleResponse(raw: string): void {
    try {
      const msg = JSON.parse(raw);
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      if (msg.error) {
        p.reject(new Error(msg.error));
      } else {
        p.resolve(msg.result);
      }
    } catch { /* ignore */ }
  }

  private rejectAll(reason: string): void {
    for (const [, p] of this.pending) {
      p.reject(new Error(reason));
    }
    this.pending.clear();
  }

  async call(method: string, params: Record<string, unknown> = {}, timeoutMs = 300_000): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`IPC call "${method}" timed out`));
      }, timeoutMs);
      const orig = this.pending.get(id)!;
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(timer); orig.resolve(v); },
        reject: (e) => { clearTimeout(timer); orig.reject(e); },
      });
      this.conn.write(JSON.stringify({ id, method, params }) + '\n');
    });
  }

  disconnect(): void {
    this.conn.destroy();
    this.pending.clear();
  }
}
