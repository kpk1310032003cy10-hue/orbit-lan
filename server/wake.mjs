import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { isIPv4 } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const normalizeMac = (value) =>
  String(value || '')
    .replace(/-/g, ':')
    .toUpperCase();
const integer = (ip) => ip.split('.').reduce((a, x) => ((a << 8) | Number(x)) >>> 0, 0);
const address = (value) => [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');

export function wakeProfile(ip, interfaces = os.networkInterfaces()) {
  if (!isIPv4(ip) || ip.startsWith('127.')) return null;
  for (const entries of Object.values(interfaces)) {
    const entry = entries?.find(
      (item) => item.address === ip && item.family === 'IPv4' && !item.internal,
    );
    if (!entry || !isIPv4(entry.netmask)) continue;
    const mac = normalizeMac(entry.mac);
    if (
      !/^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$/.test(mac) ||
      parseInt(mac.slice(0, 2), 16) & 1 ||
      mac === '00:00:00:00:00:00'
    )
      return null;
    const inverse = ~integer(entry.netmask) >>> 0;
    // An ordinary broadcast subnet is required; /31, /32 and non-contiguous masks are not usable.
    if (inverse < 3 || inverse === 0xffffffff || ((inverse + 1) & inverse) !== 0) return null;
    return { ip, mac, broadcast: address((integer(ip) | inverse) >>> 0), port: 9, protocol: 'UDP' };
  }
  return null;
}

export class WakeStatus {
  constructor({
    ip,
    base,
    stateDir,
    platform = process.platform,
    inspect,
    interfaces,
    now = Date.now,
  }) {
    Object.assign(this, { ip, base, stateDir, platform, interfaces, now });
    this.inspect =
      inspect ||
      (async () => {
        const { stdout } = await exec(
          'powershell.exe',
          [
            '-NoProfile',
            '-NonInteractive',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            path.join(base, 'scripts/wake.ps1'),
            '-Mode',
            'Inspect',
            '-IPAddress',
            ip,
            '-StatePath',
            stateDir,
          ],
          { windowsHide: true, timeout: 10000, maxBuffer: 100000 },
        );
        return JSON.parse(stdout.replace(/^\uFEFF/, ''));
      });
  }
  read({ force = false } = {}) {
    if (this.pending) return this.pending;
    if (!force && this.cached && this.now() - this.cached.checkedAt < 15000)
      return Promise.resolve(this.cached);
    this.pending = this.refresh().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }
  async refresh() {
    const profile = wakeProfile(this.ip, this.interfaces);
    const result = {
      profile,
      state: 'unknown',
      adapter: null,
      armed: null,
      magicPacket: null,
      checkedAt: this.now(),
      testedFromSleep: false,
      needsAdapterRestart: false,
    };
    if (!profile || this.platform !== 'win32') return (this.cached = result);
    try {
      const snapshot = await this.inspect();
      if (normalizeMac(snapshot.mac) !== profile.mac || snapshot.ip !== this.ip)
        throw new Error('Adapter changed during inspection');
      result.adapter = snapshot.adapter;
      result.armed = typeof snapshot.armed === 'boolean' ? snapshot.armed : null;
      result.magicPacket = typeof snapshot.magicPacket === 'boolean' ? snapshot.magicPacket : null;
      result.state =
        result.armed === true && result.magicPacket === true
          ? 'configured'
          : result.armed === false || result.magicPacket === false
            ? 'needs_setup'
            : 'unknown';
      const report = await fs
        .readFile(path.join(this.stateDir, 'wake-result.json'), 'utf8')
        .then((s) => JSON.parse(s.replace(/^\uFEFF/, '')))
        .catch(() => null);
      if (
        report?.ok &&
        normalizeMac(report.snapshot?.mac) === profile.mac &&
        report.snapshot?.needsAdapterRestart &&
        report.changedAt > this.now() - os.uptime() * 1000
      ) {
        result.needsAdapterRestart = true;
        result.state = 'needs_restart';
      }
    } catch {
      result.state = 'unknown';
    }
    return (this.cached = result);
  }
}
