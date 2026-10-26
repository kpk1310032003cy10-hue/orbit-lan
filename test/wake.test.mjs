import test from 'node:test';
import assert from 'node:assert/strict';
import { WakeStatus, wakeProfile } from '../server/wake.mjs';

const ip = '192.168.50.10';
const mac = '02:00:00:00:00:10';
const interfaces = {
  WiFi: [{ family: 'IPv4', address: ip, netmask: '255.255.254.0', mac, internal: false }],
};

test('wake profile uses the configured interface and its actual broadcast subnet', () => {
  assert.deepEqual(wakeProfile(ip, interfaces), {
    ip,
    mac,
    broadcast: '192.168.51.255',
    port: 9,
    protocol: 'UDP',
  });
  assert.equal(wakeProfile('127.0.0.1', interfaces), null);
  assert.equal(wakeProfile('192.168.50.11', interfaces), null);
  for (const [field, value] of [
    ['mac', '00:00:00:00:00:00'],
    ['mac', 'FF:FF:FF:FF:FF:FF'],
    ['mac', 'invalid'],
    ['netmask', '255.0.255.0'],
    ['netmask', '255.255.255.255'],
  ]) {
    assert.equal(wakeProfile(ip, { WiFi: [{ ...interfaces.WiFi[0], [field]: value }] }), null);
  }
});

test('inspection coalesces concurrent reads, caches briefly and manual refresh bypasses the cache', async () => {
  let calls = 0;
  const status = new WakeStatus({
    ip,
    interfaces,
    platform: 'win32',
    base: '.',
    stateDir: '.',
    inspect: async () => {
      calls++;
      await new Promise((resolve) => setImmediate(resolve));
      return {
        ip,
        mac,
        armed: true,
        magicPacket: true,
        adapter: 'Demo adapter',
        deviceId: 'private',
      };
    },
  });
  const [a, b] = await Promise.all([status.read(), status.read()]);
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal(a.state, 'configured');
  assert.equal(a.testedFromSleep, false, 'Armed is not a completed wake test');
  assert.equal('deviceId' in a, false);
  await status.read();
  assert.equal(calls, 1);
  await status.read({ force: true });
  assert.equal(calls, 2);
});

test('driver errors, missing permissions and changed adapters never report configured', async () => {
  const options = { ip, interfaces, platform: 'win32', base: '.', stateDir: '.' };
  for (const snapshot of [
    { ip, mac, armed: false, magicPacket: true },
    { ip, mac, armed: null, magicPacket: null },
    { ip, mac: '02:00:00:00:00:11', armed: true, magicPacket: true },
  ]) {
    const result = await new WakeStatus({ ...options, inspect: async () => snapshot }).read();
    assert.notEqual(result.state, 'configured');
    assert.equal(result.testedFromSleep, false);
  }
  const failed = await new WakeStatus({
    ...options,
    inspect: async () => {
      throw new Error('driver unavailable');
    },
  }).read();
  assert.equal(failed.state, 'unknown');
  assert.equal(failed.armed, null);
  const unsupported = await new WakeStatus({
    ...options,
    platform: 'linux',
    inspect: () => {
      throw new Error('Must not execute PowerShell');
    },
  }).read();
  assert.equal(unsupported.state, 'unknown');
});
