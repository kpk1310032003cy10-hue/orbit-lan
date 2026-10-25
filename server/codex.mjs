import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { EventEmitter } from 'node:events';
import { config } from './config.mjs';

const exec = promisify(execFile);
export async function findCodex() {
  if (config.codexPath && fs.existsSync(config.codexPath)) return config.codexPath;
  if (process.platform !== 'win32') return 'codex';
  const dir = path.join(os.homedir(), '.vscode', 'extensions');
  try {
    const candidates = fs
      .readdirSync(dir)
      .filter((x) => x.startsWith('openai.chatgpt-'))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const c of candidates) {
      const bin = path.join(dir, c, 'bin', 'windows-x86_64', 'codex.exe');
      if (fs.existsSync(bin)) return bin;
    }
  } catch {}
  return 'codex';
}
export class CodexRPC extends EventEmitter {
  constructor(binary, args = ['app-server', '--stdio']) {
    super();
    this.binary = binary;
    this.args = args;
    this.next = 1;
    this.pending = new Map();
    this.child = null;
    this.initializing = null;
    this.stopped = false;
  }
  async ready() {
    if (this.initializing) return this.initializing;
    this.initializing = this.connect().catch((e) => {
      this.initializing = null;
      throw e;
    });
    return this.initializing;
  }
  async connect() {
    if (this.stopped) throw new Error('Codex остановлен');
    const child = spawn(this.binary, this.args, {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    this.stderr = '';
    child.stderr.on('data', (b) => {
      this.stderr = (this.stderr + b).slice(-3000);
    });
    const rl = readline.createInterface({ input: child.stdout });
    rl.on('line', (line) => {
      try {
        this.receive(JSON.parse(line));
      } catch (e) {
        this.emit('diagnostic', e.message);
      }
    });
    child.stdin.on('error', () => {});
    const died = (e) => {
      if (this.child !== child) return;
      this.child = null;
      this.initializing = null;
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(e);
      }
      this.pending.clear();
      this.emit('disconnected', e.message);
    };
    child.once('error', (e) => died(new Error(`Codex: ${e.message}`)));
    child.once('exit', (code) =>
      died(new Error(`Соединение с Codex закрыто (${code}). ${this.stderr.slice(-500)}`)),
    );
    await this.raw('initialize', {
      clientInfo: { name: 'orbit_lan', title: 'Orbit LAN', version: '1.0.0' },
      capabilities: { experimentalApi: true },
    });
    this.notify('initialized', {});
    return this;
  }
  receive(message) {
    if ('id' in message && !message.method) {
      const p = this.pending.get(message.id);
      if (!p) return;
      this.pending.delete(message.id);
      clearTimeout(p.timer);
      message.error
        ? p.reject(Object.assign(new Error(message.error.message), { rpcCode: message.error.code }))
        : p.resolve(message.result);
    } else if ('id' in message) this.emit('request', message);
    else this.emit('notification', message);
  }
  send(value) {
    if (!this.child || this.child.stdin.destroyed) throw new Error('Нет соединения с Codex');
    this.child.stdin.write(JSON.stringify(value) + '\n');
  }
  raw(method, params, timeout = 30_000) {
    return new Promise((resolve, reject) => {
      const id = this.next++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Codex не ответил на ${method}. Проверьте состояние перед повтором.`));
      }, timeout);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ id, method, params });
      } catch (e) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  async call(method, params) {
    await this.ready();
    return this.raw(method, params);
  }
  notify(method, params) {
    this.send({ method, params });
  }
  respond(id, result) {
    this.send({ id, result });
  }
  reject(id, message = 'Этот тип запроса пока не поддерживается клиентом') {
    this.send({ id, error: { code: -32601, message } });
  }
  async account() {
    try {
      const r = await this.call('account/read', { refreshToken: false });
      return { available: true, authenticated: Boolean(r.account), type: r.account?.type || null };
    } catch (e) {
      return { available: false, authenticated: false, error: e.message };
    }
  }
  async queue(threadId, text) {
    return this.call('thread/queue/add', {
      threadId,
      clientUserMessageId: crypto.randomUUID(),
      input: [{ type: 'text', text }],
    });
  }
  close() {
    this.stopped = true;
    this.child?.stdin.end();
    this.child?.kill();
  }
}
