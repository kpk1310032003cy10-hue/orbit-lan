import os from 'node:os';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { StringDecoder } from 'node:string_decoder';
import { config } from './config.mjs';

const exec = promisify(execFile);
export const stopTree = async (pid) => {
  if (!Number.isInteger(pid) || pid === process.pid) throw new Error('Некорректный процесс');
  if (process.platform === 'win32')
    await exec('taskkill.exe', ['/PID', String(pid), '/T', '/F'], {
      windowsHide: true,
      timeout: 8000,
    });
  else {
    try {
      process.kill(-pid, 'SIGTERM');
    } catch {
      process.kill(pid, 'SIGTERM');
    }
  }
};
export class Processes {
  constructor() {
    this.snapshot = { processes: [], updated: null, error: null };
    this.previousCPU = this.cpu();
  }
  cpu() {
    return os.cpus().reduce(
      (s, c) => {
        s.idle += c.times.idle;
        s.total += Object.values(c.times).reduce((a, b) => a + b, 0);
        return s;
      },
      { idle: 0, total: 0 },
    );
  }
  metrics() {
    const current = this.cpu();
    const delta = current.total - this.previousCPU.total;
    const cpu = delta ? Math.round((1 - (current.idle - this.previousCPU.idle) / delta) * 100) : 0;
    this.previousCPU = current;
    return {
      cpu,
      memoryUsed: os.totalmem() - os.freemem(),
      memoryTotal: os.totalmem(),
      hostname: os.hostname(),
      uptime: os.uptime(),
      ...this.snapshot,
    };
  }
  async refresh() {
    try {
      if (process.platform === 'win32') {
        const script =
          '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); Get-Process | Select-Object Id,ProcessName,WorkingSet64,CPU,StartTime | ConvertTo-Json -Compress';
        const { stdout } = await exec(
          'powershell.exe',
          ['-NoProfile', '-NonInteractive', '-Command', script],
          { windowsHide: true, timeout: 8000, maxBuffer: 2_000_000 },
        );
        const list = JSON.parse(stdout || '[]');
        this.snapshot.processes = (Array.isArray(list) ? list : [list])
          .filter((p) =>
            config.watchProcesses.some((n) =>
              p.ProcessName.toLowerCase().includes(n.toLowerCase()),
            ),
          )
          .map((p) => ({
            pid: p.Id,
            name: p.ProcessName,
            memory: p.WorkingSet64,
            cpuSeconds: p.CPU || 0,
            owned: p.Id === process.pid,
          }));
      } else
        this.snapshot.processes = [
          {
            pid: process.pid,
            name: 'orbit (node)',
            memory: process.memoryUsage().rss,
            cpuSeconds: process.cpuUsage().user / 1e6,
            owned: true,
          },
        ];
      this.snapshot.updated = Date.now();
      this.snapshot.error = null;
    } catch (e) {
      this.snapshot.error = e.message;
    }
  }
}
export class Tasks {
  constructor(store, files, onEvent) {
    this.store = store;
    this.files = files;
    this.onEvent = onEvent;
    this.running = new Map();
    for (const a of store.agents())
      if (a.provider === 'task' && a.status === 'running')
        store.updateAgent(a.id, { status: 'disconnected' });
  }
  async start(cwd, command) {
    if (typeof command !== 'string' || !command.trim() || command.length > 4000)
      throw new Error('Укажите команду до 4000 символов');
    if (this.running.size >= 6) throw new Error('Уже запущены шесть команд');
    cwd = await this.files.validateCwd(cwd);
    const a = this.store.createAgent('task', command.slice(0, 120), cwd);
    const event = (kind, payload) => this.onEvent(this.store.event(a.id, kind, payload));
    let child;
    if (process.platform === 'win32') {
      const script = `[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); $OutputEncoding=[System.Text.UTF8Encoding]::new(); $ProgressPreference='SilentlyContinue'; ${command}`;
      child = spawn(
        'powershell.exe',
        [
          '-NoLogo',
          '-NoProfile',
          '-NonInteractive',
          '-OutputFormat',
          'Text',
          '-EncodedCommand',
          Buffer.from(script, 'utf16le').toString('base64'),
        ],
        { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
      );
    } else
      child = spawn('/bin/sh', ['-c', command], {
        cwd,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    this.running.set(a.id, child);
    this.store.updateAgent(a.id, { status: 'running' });
    event('status', { status: 'running' });
    for (const channel of ['stdout', 'stderr']) {
      const decoder = new StringDecoder('utf8');
      let total = 0,
        limited = false;
      child[channel].on('data', (b) => {
        total += b.length;
        if (total <= 8_000_000) event('output', { text: decoder.write(b), channel });
        else if (!limited) {
          limited = true;
          event('system', { text: 'Лимит журнала 8 МБ достигнут; команда продолжает работать.' });
        }
      });
      child[channel].on('end', () => {
        const tail = decoder.end();
        if (tail && !limited) event('output', { text: tail, channel });
      });
    }
    child.once('error', (e) => event('error', { text: e.message }));
    child.once('close', (code) => {
      this.running.delete(a.id);
      const status =
        this.store.agent(a.id).status === 'stopping' ? 'stopped' : code === 0 ? 'idle' : 'failed';
      this.store.updateAgent(a.id, { status });
      event('status', { status });
      event('completed', { code, status });
    });
    this.store.audit('task.started', { id: a.id, cwd, command });
    return this.store.agent(a.id);
  }
  async stop(id) {
    const child = this.running.get(id);
    if (!child) throw Object.assign(new Error('Команда уже завершена'), { status: 409 });
    this.store.updateAgent(id, { status: 'stopping' });
    await stopTree(child.pid);
    this.store.audit('task.stop', { id });
  }
  async close() {
    await Promise.allSettled([...this.running.keys()].map((id) => this.stop(id)));
  }
}
