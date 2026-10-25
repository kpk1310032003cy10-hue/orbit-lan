import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { X509Certificate, createPrivateKey } from 'node:crypto';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-test-'));
process.env.ORBIT_STATE_DIR = path.join(temp, 'state');
const { Store } = await import('../server/store.mjs');
const { Security, hash } = await import('../server/security.mjs');
const { Files, within } = await import('../server/files.mjs');
const { certificates } = await import('../server/certificates.mjs');
const root = path.join(temp, 'root');
await fs.mkdir(root);
const files = new Files({ roots: [{ id: 'root', path: root }] });
after(async () => {
  await fs.rm(temp, { recursive: true, force: true });
});

test('file boundary denies traversal, NTFS streams, secrets and junction escapes', async () => {
  await fs.writeFile(path.join(root, 'readme.txt'), 'Привет');
  await fs.writeFile(path.join(root, '.env'), 'secret');
  const outside = path.join(temp, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'value.txt'), 'private');
  await fs.symlink(
    outside,
    path.join(root, 'escape'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  for (const relative of [
    '../outside/value.txt',
    '..\\outside\\value.txt',
    '.env',
    '.ENV',
    '.env.local',
    'file.txt:secret',
    'escape/value.txt',
  ]) {
    await assert.rejects(files.resolve('root', relative));
  }
  assert.equal(within(root, root + '-other'), false);
  assert.equal((await files.read('root', 'readme.txt')).content, 'Привет');
  assert.equal(
    (await files.list('root', '')).items.some((x) => x.name === '.env'),
    false,
  );
});
test('text edits preserve a backup and reject an outdated version', async () => {
  const first = await files.read('root', 'readme.txt');
  const second = await files.write('root', 'readme.txt', 'Изменённый текст', first.version);
  assert.equal(second.content, 'Изменённый текст');
  const backups = await fs.readdir(path.join(temp, 'state', 'backups'));
  assert.equal(backups.length, 1);
  assert.equal(
    await fs.readFile(path.join(temp, 'state', 'backups', backups[0]), 'utf8'),
    'Привет',
  );
  await assert.rejects(files.write('root', 'readme.txt', 'stale', first.version), { status: 409 });
  await fs.writeFile(path.join(root, 'binary'), Buffer.from([1, 0, 4]));
  await assert.rejects(files.read('root', 'binary'), /Двоичный/);
});
test('device pairing: one-use PIN, hashed cookie, expiry and immediate revocation', () => {
  const store = new Store(':memory:');
  const sec = new Security(store);
  const old = sec.pin;
  const { token, device } = sec.pair('192.168.0.2', old, 'iPad');
  assert.equal(store.db.prepare('SELECT token_hash FROM devices').get().token_hash, hash(token));
  assert.notEqual(sec.pin, old);
  const req = {
    socket: { remoteAddress: '192.168.0.2', encrypted: true },
    headers: { cookie: `orbit=${token}` },
  };
  assert.equal(sec.authenticate(req).id, device.id);
  sec.revoke(device.id);
  assert.equal(sec.authenticate(req), null);
  sec.pinExpires = Date.now() - 10;
  assert.throws(() => sec.pair('192.168.0.3', sec.pin, 'old'), { status: 401 });
  store.close();
});
test('PIN brute force and cross-origin mutations are denied', () => {
  const store = new Store(':memory:');
  const sec = new Security(store);
  for (let i = 0; i < 8; i++)
    assert.throws(() => sec.pair('192.168.0.4', '000000', 'bad'), { status: 401 });
  assert.throws(() => sec.pair('192.168.0.4', sec.pin, 'bad'), { status: 429 });
  assert.equal(
    sec.checkOrigin(
      { socket: { encrypted: true }, headers: { origin: 'https://evil.example' } },
      '192.0.2.29:8788',
    ),
    false,
  );
  assert.equal(
    sec.checkOrigin({ socket: {}, headers: { origin: 'http://127.0.0.1:8787' } }, '127.0.0.1:8787'),
    true,
  );
  store.close();
});
test('TLS certificate retains the same CA across an IP change', async () => {
  const first = await certificates('192.168.1.2'),
    second = await certificates('192.168.1.3');
  assert.equal(first.fingerprint, second.fingerprint);
  assert.notEqual(first.cert, second.cert);
  assert.ok(first.caDER.length > 500);
  const ca = new X509Certificate(second.caDER),
    leaf = new X509Certificate(second.cert);
  assert.equal(ca.ca, true);
  assert.equal(leaf.ca, false);
  assert.equal(leaf.checkIP('192.168.1.3'), '192.168.1.3');
  assert.equal(leaf.checkHost('localhost'), 'localhost');
  assert.equal(leaf.verify(ca.publicKey), true);
});
test('legacy PKCS#1 CA keys remain trusted during certificate renewal', async () => {
  const first = await certificates('192.168.1.3');
  const keyPath = path.join(temp, 'state', 'tls', 'ca-key.pem');
  const legacy = createPrivateKey(await fs.readFile(keyPath)).export({
    type: 'pkcs1',
    format: 'pem',
  });
  await fs.writeFile(keyPath, legacy);
  const renewed = await certificates('192.168.1.4');
  assert.equal(renewed.fingerprint, first.fingerprint);
  assert.equal(
    new X509Certificate(renewed.cert).verify(new X509Certificate(first.caDER).publicKey),
    true,
  );
});
