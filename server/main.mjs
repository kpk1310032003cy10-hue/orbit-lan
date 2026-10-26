import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import QRCode from 'qrcode';
import {
  base,
  config,
  stateDir,
  networks,
  inSubnet,
  loopback,
  unmap,
  saveConfig,
  cleanPath,
} from './config.mjs';
import { Store } from './store.mjs';
import { Security, safeEqual } from './security.mjs';
import { certificates } from './certificates.mjs';
import { Files } from './files.mjs';
import { CodexRPC, findCodex } from './codex.mjs';
import { Discovery } from './discovery.mjs';
import { Agents } from './agents.mjs';
import { Processes, Tasks } from './processes.mjs';
import { Limits } from './limits.mjs';
import { WakeStatus } from './wake.mjs';

const exec = promisify(execFile);
// A second launch must not change the state of sessions owned by the first.
const lockPath = path.join(stateDir, 'server.lock');
if (fs.existsSync(lockPath)) {
  let oldPid;
  try {
    oldPid = Number(fs.readFileSync(lockPath, 'utf8'));
    process.kill(oldPid, 0);
  } catch {
    oldPid = null;
  }
  if (oldPid) {
    console.error('Орбита уже запущена. Откройте её локальную страницу.');
    process.exit(1);
  }
  fs.unlinkSync(lockPath);
}
fs.writeFileSync(lockPath, String(process.pid), { flag: 'wx', mode: 0o600 });
const store = new Store();
const security = new Security(store);
const files = new Files(config);
const rpc = new CodexRPC(await findCodex());
const discovery = new Discovery(config, rpc);
const agents = new Agents(store, rpc, files);
const processes = new Processes();
const clients = new Set();
let closing = false;
let processTimer, heartbeat, limitsTimer;
const broadcast = (event) => {
  for (const c of clients) {
    if (c.res.writableLength > 2_000_000) {
      c.res.end();
      clients.delete(c);
      continue;
    }
    c.res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
};
agents.on('event', broadcast);
const limits = new Limits(rpc);
const wake = new WakeStatus({ ip: config.lanIP, base, stateDir });
limits.on('update', (payload) => broadcast({ kind: 'limits.updated', payload }));
agents.on('rateLimits', ({ provider, info }) => {
  if (provider === 'claude') limits.observeClaude(info);
});
const tasks = new Tasks(store, files, broadcast);
const tls = await certificates(config.lanIP);
const lanURL = `https://${config.lanIP}:${config.httpsPort}`;
const localURL = `http://127.0.0.1:${config.httpPort}`;
const setupURL = `http://${config.lanIP}:${config.httpPort}`;
const qr = await QRCode.toDataURL(setupURL, {
  width: 260,
  margin: 2,
  color: { dark: '#17212b', light: '#ffffff' },
});
const hosts = new Set([
  `127.0.0.1:${config.httpPort}`,
  `localhost:${config.httpPort}`,
  `${config.lanIP}:${config.httpPort}`,
  `${config.lanIP}:${config.httpsPort}`,
  `127.0.0.1:${config.httpsPort}`,
  `localhost:${config.httpsPort}`,
]);
let providerStatus = {
  codex: { available: true, authenticated: null },
  claude: { available: true, authenticated: false },
};
async function refreshProviders() {
  const codex = await rpc.account();
  let claude = {
    available: true,
    authenticated: false,
    note: 'Войдите в Claude Code на компьютере: scripts/claude-login.ps1',
  };
  try {
    const bin = path.join(
      base,
      'node_modules/@anthropic-ai',
      `claude-agent-sdk-${process.platform}-${process.arch}`,
      process.platform === 'win32' ? 'claude.exe' : 'claude',
    );
    const { stdout } = await exec(bin, ['auth', 'status'], {
      windowsHide: true,
      timeout: 15000,
      maxBuffer: 100000,
    });
    const status = JSON.parse(stdout);
    claude = {
      available: true,
      authenticated: Boolean(status.loggedIn),
      note: status.loggedIn ? null : claude.note,
    };
  } catch (e) {
    if (e.stdout) {
      try {
        const s = JSON.parse(e.stdout);
        claude.authenticated = Boolean(s.loggedIn);
      } catch {}
    }
  }
  providerStatus = { codex, claude };
  limits.setClaudeAuthentication(claude.authenticated);
  return providerStatus;
}
function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(data));
}
async function body(req) {
  if (!req.headers['content-type']?.startsWith('application/json'))
    throw Object.assign(new Error('Ожидается JSON'), { status: 415 });
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > 1_200_000)
      throw Object.assign(new Error('Запрос слишком большой'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error();
    return value;
  } catch {
    throw Object.assign(new Error('Некорректный JSON'), { status: 400 });
  }
}
function networkAllowed(req) {
  const ip = unmap(req.socket.remoteAddress);
  if (loopback(req.socket.remoteAddress)) return true;
  const nic = networks().find((n) => n.ip === config.lanIP);
  return Boolean(
    nic && unmap(req.socket.localAddress) === config.lanIP && inSubnet(ip, nic.ip, nic.netmask),
  );
}
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
async function servePublic(res, filename) {
  const content = await fsp.readFile(path.join(base, 'public', filename));
  res.writeHead(200, {
    'Content-Type': mime[path.extname(filename)] || 'application/octet-stream',
    'Cache-Control': filename === 'sw.js' ? 'no-cache' : 'no-store',
  });
  res.end(content);
}
function enrollment(res) {
  const html = `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#f5f6f2"><script src="/theme.js"></script><title>Орбита · Подключение</title><link rel="stylesheet" href="/style.css"><main class="enrollment"><div class="brand-mark">◉</div><p class="eyebrow">ВАШ КОМПЬЮТЕР · ВАША СЕТЬ</p><h1>Орбита на вашем устройстве</h1><p>Один раз настройте защищённое подключение к компьютеру.</p><ol><li><a class="primary button" href="/ca.crt">Скачать сертификат Орбиты</a><p>Safari предложит загрузить профиль. Откройте «Настройки → Основные → VPN и управление устройством» и установите загруженный профиль.</p></li><li><strong>Включите доверие</strong><p>«Настройки → Основные → Об этом устройстве → Доверие сертификатам». Включите доверие для Orbit LAN.</p></li><li><a class="primary button" href="${lanURL}">Открыть Орбиту ↗</a><p>Введите одноразовый код с экрана компьютера. Затем в Safari выберите «Поделиться → На экран Домой».</p></li></ol><p class="small">Сертификат выпущен вашим компьютером для локального соединения. Сверьте его отпечаток на компьютере перед установкой.</p><code class="fingerprint">${tls.fingerprint}</code></main></html>`;
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}
async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  try {
    if (!hosts.has(req.headers.host) || !networkAllowed(req))
      return json(res, 403, { error: 'Доступ разрешён только из выбранной локальной сети' });
    const url = new URL(req.url, localURL);
    const p = url.pathname;
    const isLocal = loopback(req.socket.remoteAddress) && !req.socket.encrypted;
    if (!req.socket.encrypted && !isLocal) {
      if (req.method !== 'GET')
        return json(res, 403, { error: 'Для управления откройте HTTPS-адрес' });
      if (p === '/ca.crt') {
        res.writeHead(200, {
          'Content-Type': 'application/x-x509-ca-cert',
          'Content-Disposition': 'attachment; filename="Orbit-LAN-Root.crt"',
          'Cache-Control': 'no-store',
        });
        return res.end(tls.caDER);
      }
      if (p === '/theme.js') return await servePublic(res, 'theme.js');
      if (p === '/style.css') return await servePublic(res, 'style.css');
      if (p === '/') return enrollment(res);
      return json(res, 404, { error: 'Страница не найдена' });
    }
    const mutation = !['GET', 'HEAD'].includes(req.method);
    if (mutation && !security.checkOrigin(req, req.headers.host))
      return json(res, 403, { error: 'Источник запроса не совпадает с адресом сервиса' });
    if (p === '/api/pair' && req.method === 'POST') {
      const b = await body(req);
      const { token, device } = security.pair(unmap(req.socket.remoteAddress), b.pin, b.name);
      res.setHeader(
        'Set-Cookie',
        `orbit=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=2592000`,
      );
      return json(res, 200, { device });
    }
    const device = security.authenticate(req);
    if (p === '/api/session')
      return json(res, 200, { authenticated: Boolean(device), device, local: isLocal });
    if (p.startsWith('/api/')) {
      if (!device)
        return json(res, 401, { error: 'Подключите это устройство по коду с компьютера' });
      if (mutation && !safeEqual(req.headers['x-orbit-csrf'], device.csrf))
        return json(res, 403, { error: 'Защита запроса: обновите страницу' });
      const b = mutation ? await body(req) : {};
      if (p === '/api/bootstrap' && req.method === 'GET')
        return json(res, 200, {
          name: config.name,
          roots: config.roots,
          providers: providerStatus,
          device,
          urls: { local: localURL, secure: lanURL, setup: setupURL },
          ...(isLocal ? { pairing: security.getPin(), qr, fingerprint: tls.fingerprint } : {}),
        });
      if (p === '/api/overview' && req.method === 'GET')
        return json(res, 200, {
          agents: agents.list().filter((a) => a.provider !== 'task'),
          tasks: store
            .agents()
            .filter((a) => a.provider === 'task')
            .map((a) => ({ ...a, canStop: tasks.running.has(a.id) })),
          discovered: discovery.list(),
          system: processes.metrics(),
          limits: limits.snapshot(),
        });
      if (p === '/api/limits' && req.method === 'GET') return json(res, 200, limits.snapshot());
      if (p === '/api/wake' && req.method === 'GET')
        return json(res, 200, await wake.read({ force: url.searchParams.get('refresh') === '1' }));
      if (p === '/api/limits/refresh' && req.method === 'POST')
        return json(res, 200, await limits.refreshCodex());
      if (p === '/api/events' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        });
        res.write('retry: 2000\ndata: {"kind":"connected"}\n\n');
        const client = { res, deviceId: device.id };
        clients.add(client);
        req.on('close', () => clients.delete(client));
        return;
      }
      if (p === '/api/agents' && req.method === 'POST') {
        if (b.forkId && !discovery.get(b.forkId))
          return json(res, 404, { error: 'Исходная сессия не найдена' });
        return json(res, 201, await agents.create(b));
      }
      const action = /^\/api\/agents\/([a-f0-9-]+)\/(message|stop|events)$/.exec(p);
      if (action) {
        const [, id, operation] = action;
        const a = store.agent(id);
        if (!a) return json(res, 404, { error: 'Сессия не найдена' });
        if (operation === 'events' && req.method === 'GET')
          return json(res, 200, {
            events: store.events(
              id,
              url.searchParams.has('before') ? Number(url.searchParams.get('before')) : undefined,
            ),
          });
        if (operation === 'message' && req.method === 'POST')
          return json(res, 200, await agents.message(id, b.text));
        if (operation === 'stop' && req.method === 'POST') {
          a.provider === 'task' ? await tasks.stop(id) : await agents.stop(id);
          return json(res, 200, { accepted: true });
        }
      }
      const approval = /^\/api\/prompts\/([a-f0-9-]+)$/.exec(p);
      if (approval && req.method === 'POST') {
        await agents.answer(approval[1], b);
        return json(res, 200, { accepted: true });
      }
      const external = /^\/api\/external\/([a-f0-9-]+)\/(history|queue)$/.exec(p);
      if (external) {
        const [, id, operation] = external;
        if (!discovery.get(id)) return json(res, 404, { error: 'Сессия не найдена' });
        if (operation === 'history' && req.method === 'GET')
          return json(res, 200, await discovery.history(id, url.searchParams.get('cursor')));
        if (operation === 'queue' && req.method === 'POST') {
          if (typeof b.text !== 'string' || !b.text.trim() || b.text.length > 32000)
            return json(res, 400, { error: 'Укажите сообщение до 32000 символов' });
          const result = await rpc.queue(id, b.text);
          store.audit('external.queued', { id });
          return json(res, 200, {
            accepted: true,
            result,
            note: 'Сообщение добавлено в очередь Codex. Обработка зависит от клиента, в котором открыт диалог.',
          });
        }
      }
      if (p === '/api/files' && req.method === 'GET')
        return json(
          res,
          200,
          await files.list(url.searchParams.get('root'), url.searchParams.get('path') || ''),
        );
      if (p === '/api/file' && req.method === 'GET')
        return json(
          res,
          200,
          await files.read(url.searchParams.get('root'), url.searchParams.get('path')),
        );
      if (p === '/api/file' && req.method === 'POST') {
        const result = await files.write(b.root, b.path, b.content, b.version);
        store.audit('file.saved', { root: b.root, path: b.path });
        return json(res, 200, result);
      }
      if (p === '/api/download' && req.method === 'GET') {
        const { full } = await files.resolve(
          url.searchParams.get('root'),
          url.searchParams.get('path'),
        );
        const stat = await fsp.stat(full);
        if (!stat.isFile()) return json(res, 400, { error: 'Выберите файл' });
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': stat.size,
          'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.basename(full))}`,
        });
        const stream = fs.createReadStream(full);
        res.once('close', () => stream.destroy());
        stream.on('error', () => res.destroy());
        stream.pipe(res);
        return;
      }
      if (p === '/api/tasks' && req.method === 'POST')
        return json(res, 201, await tasks.start(b.cwd, b.command));
      if (p === '/api/devices' && req.method === 'GET')
        return json(res, 200, { devices: security.devices() });
      if (p === '/api/device/revoke' && req.method === 'POST') {
        security.revoke(b.id);
        for (const c of clients)
          if (c.deviceId === b.id) {
            c.res.end();
            clients.delete(c);
          }
        return json(res, 200, { success: true });
      }
      if (p === '/api/logout' && req.method === 'POST') {
        if (!device.local) security.revoke(device.id);
        res.setHeader('Set-Cookie', 'orbit=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0');
        return json(res, 200, { success: true });
      }
      if (p === '/api/audit' && req.method === 'GET')
        return json(res, 200, { items: store.history() });
      if (p === '/api/providers/refresh' && req.method === 'POST')
        return json(res, 200, await refreshProviders());
      if (p === '/api/pairing/rotate' && req.method === 'POST' && isLocal)
        return json(res, 200, security.rotatePin());
      if (p === '/api/roots' && req.method === 'POST' && isLocal) {
        const rootPath = await fsp.realpath(cleanPath(String(b.path || '')));
        if (!(await fsp.stat(rootPath)).isDirectory())
          return json(res, 400, { error: 'Выберите каталог' });
        if (config.roots.some((r) => r.path.toLowerCase() === rootPath.toLowerCase()))
          return json(res, 409, { error: 'Папка уже подключена' });
        config.roots.push({
          id: crypto.randomUUID(),
          name: String(b.name || path.basename(rootPath)).slice(0, 80),
          path: rootPath,
        });
        saveConfig();
        store.audit('root.added', { path: rootPath });
        return json(res, 200, { roots: config.roots });
      }
      return json(res, 404, { error: 'Действие не найдено' });
    }
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return json(res, 405, { error: 'Метод не поддерживается' });
    const publicFiles = new Set([
      'index.html',
      'app.js',
      'theme.js',
      'style.css',
      'limits.js',
      'limits.css',
      'manifest.webmanifest',
      'sw.js',
      'icon.svg',
      'icon-192.png',
      'icon-512.png',
    ]);
    const filename = p === '/' ? 'index.html' : p.slice(1);
    if (!publicFiles.has(filename)) return json(res, 404, { error: 'Страница не найдена' });
    await servePublic(res, filename);
  } catch (e) {
    if (!res.headersSent)
      json(res, e.status || 500, { error: e.message || 'Не удалось выполнить действие' });
    else res.end();
  }
}
const httpServer = http.createServer(handler);
const httpsServer = https.createServer(
  { cert: tls.cert, key: tls.key, minVersion: 'TLSv1.2' },
  handler,
);
for (const s of [httpServer, httpsServer]) {
  s.headersTimeout = 15000;
  s.requestTimeout = 30000;
  s.on('error', (e) => {
    console.error(e.message);
    shutdown(1);
  });
}
const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', resolve);
  });
await listen(httpServer, config.httpPort);
await listen(httpsServer, config.httpsPort);
fs.writeFileSync(
  path.join(stateDir, 'runtime.json'),
  JSON.stringify(
    { pid: process.pid, localURL, lanURL, setupURL, started: Date.now(), base },
    null,
    2,
  ),
);
console.log(
  `Орбита запущена\nКомпьютер: ${localURL}\niPhone / iPad: ${setupURL}\nЗащищённый адрес: ${lanURL}\nКод подключения смотрите на локальной странице.`,
);
refreshProviders().catch((e) => console.error('Providers:', e.message));
processes.refresh();
limits.refreshCodex();
limitsTimer = setInterval(() => limits.refreshCodex(), 60000);
processTimer = setInterval(() => processes.refresh(), 10000);
heartbeat = setInterval(() => {
  for (const c of clients) {
    if (
      c.deviceId !== 'local' &&
      !store.db
        .prepare('SELECT id FROM devices WHERE id=? AND expires>?')
        .get(c.deviceId, Date.now())
    ) {
      c.res.end();
      clients.delete(c);
    } else c.res.write(': heartbeat\n\n');
  }
}, 15000);
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  clearInterval(processTimer);
  clearInterval(heartbeat);
  clearInterval(limitsTimer);
  for (const c of clients) c.res.end();
  clients.clear();
  await Promise.allSettled([agents.close(), tasks.close()]);
  httpServer.close();
  httpsServer.close();
  store.close();
  try {
    fs.unlinkSync(path.join(stateDir, 'runtime.json'));
  } catch {}
  try {
    fs.unlinkSync(lockPath);
  } catch {}
  process.exit(code);
}
process.on('SIGINT', () => shutdown());
process.on('SIGTERM', () => shutdown());
process.on('uncaughtException', (e) => {
  console.error(e);
  shutdown(1);
});
