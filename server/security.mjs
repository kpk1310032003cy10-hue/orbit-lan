import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { loopback } from './config.mjs';

export const hash = (value) => createHash('sha256').update(value).digest('hex');
export const safeEqual = (a, b) =>
  typeof a === 'string' &&
  typeof b === 'string' &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
export class Security {
  constructor(store) {
    this.store = store;
    this.attempts = new Map();
    this.rotatePin();
  }
  rotatePin() {
    this.pin = String(randomInt(100000, 1000000));
    this.pinExpires = Date.now() + 5 * 60_000;
    return { pin: this.pin, expires: this.pinExpires };
  }
  getPin() {
    if (this.pinExpires < Date.now()) this.rotatePin();
    return { pin: this.pin, expires: this.pinExpires };
  }
  pair(ip, pin, name) {
    const now = Date.now();
    const recent = (this.attempts.get(ip) || []).filter((t) => t > now - 15 * 60_000);
    this.attempts.set(ip, recent);
    if (recent.length >= 8)
      throw Object.assign(new Error('Слишком много попыток. Повторите через 15 минут.'), {
        status: 429,
      });
    recent.push(now);
    if (now > this.pinExpires || !safeEqual(String(pin), this.pin))
      throw Object.assign(new Error('Код неверен или истёк. Посмотрите новый код на компьютере.'), {
        status: 401,
      });
    const token = randomBytes(32).toString('base64url');
    const device = {
      id: randomBytes(16).toString('hex'),
      name: String(name || 'Моё устройство').slice(0, 80),
      csrf: randomBytes(24).toString('base64url'),
    };
    this.store.db
      .prepare('INSERT INTO devices VALUES(?,?,?,?,?,?,?)')
      .run(device.id, device.name, hash(token), device.csrf, now, now, now + 30 * 86400_000);
    this.rotatePin();
    this.store.audit('device.paired', { id: device.id, name: device.name });
    return { device, token };
  }
  authenticate(req) {
    if (loopback(req.socket.remoteAddress) && !req.socket.encrypted)
      return { id: 'local', name: 'Этот компьютер', local: true, csrf: 'local-origin-protected' };
    const token = /(?:^|;\s*)orbit=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    if (!token) return null;
    const d = this.store.db
      .prepare('SELECT id,name,csrf,expires FROM devices WHERE token_hash=?')
      .get(hash(token));
    if (!d || d.expires < Date.now()) return null;
    this.store.db.prepare('UPDATE devices SET seen=? WHERE id=?').run(Date.now(), d.id);
    return d;
  }
  checkOrigin(req, host) {
    const expected = `${req.socket.encrypted ? 'https' : 'http'}://${host}`;
    return req.headers.origin === expected;
  }
  devices() {
    return this.store.db
      .prepare(
        'SELECT id,name,created,seen,expires FROM devices WHERE expires>? ORDER BY seen DESC',
      )
      .all(Date.now());
  }
  revoke(id) {
    this.store.db.prepare('DELETE FROM devices WHERE id=?').run(id);
    this.store.audit('device.revoked', { id });
  }
}
