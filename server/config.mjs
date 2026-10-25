import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export const base = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const stateDir =
  process.env.ORBIT_STATE_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), 'OrbitLAN');
fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
export const configFile = path.join(stateDir, 'config.json');
export const cleanPath = (p) => path.resolve(p.replace(/^\\\\\?\\/, ''));
export const networks = () =>
  Object.entries(os.networkInterfaces())
    .flatMap(([name, entries]) =>
      entries
        .filter((x) => x.family === 'IPv4' && !x.internal && !x.address.startsWith('169.254.'))
        .map((x) => ({ name, ip: x.address, netmask: x.netmask })),
    )
    .sort((a, b) => {
      const score = (x) =>
        /wi-?fi|wireless|беспровод/i.test(x.name)
          ? 0
          : /vpn|tap|tun|outline|virtual/i.test(x.name)
            ? 3
            : 1;
      return score(a) - score(b);
    });
const saved = fs.existsSync(configFile) ? JSON.parse(fs.readFileSync(configFile, 'utf8')) : {};
const root = base;
export const config = {
  name: 'Орбита',
  httpPort: Number(process.env.ORBIT_HTTP_PORT || saved.httpPort || 8787),
  httpsPort: Number(process.env.ORBIT_HTTPS_PORT || saved.httpsPort || 8788),
  lanIP: process.env.ORBIT_LAN_IP || saved.lanIP || networks()[0]?.ip || '127.0.0.1',
  roots: saved.roots || [{ id: 'workspace', name: path.basename(root), path: root }],
  codexPath: saved.codexPath || process.env.ORBIT_CODEX_PATH || '',
  watchProcesses: saved.watchProcesses || ['codex', 'claude', 'Code', 'node', 'python'],
};
export function saveConfig() {
  fs.writeFileSync(configFile, JSON.stringify(config, null, 2), { mode: 0o600 });
}
saveConfig();
export function inSubnet(ip, host, mask) {
  const n = (s) => s.split('.').reduce((a, x) => (a << 8) | Number(x), 0) >>> 0;
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) return false;
  return (n(ip) & n(mask)) === (n(host) & n(mask));
}
export const loopback = (ip) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);
export const unmap = (ip) => ip?.replace(/^::ffff:/, '') || '';
