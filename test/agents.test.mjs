import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';

const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'orbit-agents-'));
process.env.ORBIT_STATE_DIR = path.join(temp, 'state');
const { Store } = await import('../server/store.mjs');
const { Files } = await import('../server/files.mjs');
const { Agents } = await import('../server/agents.mjs');
const { CodexRPC } = await import('../server/codex.mjs');
const root = path.join(temp, 'root');
await fs.mkdir(root);
const files = new Files({ roots: [{ id: 'root', path: root }] });
after(async () => {
  await fs.rm(temp, { recursive: true, force: true });
});

class MockRPC extends EventEmitter {
  calls = [];
  responses = [];
  rejections = [];
  async call(method, params) {
    this.calls.push({ method, params });
    if (method.startsWith('thread/')) return { thread: { id: 'native-test' } };
    if (method === 'turn/start') return { turn: { id: 'turn-test' } };
    return {};
  }
  respond(id, value) {
    this.responses.push({ id, value });
  }
  reject(id) {
    this.rejections.push(id);
  }
  close() {}
}
test('managed Codex lifecycle steers, approves and interrupts the actual owned turn', async () => {
  const store = new Store(':memory:'),
    rpc = new MockRPC(),
    agents = new Agents(store, rpc, files);
  const a = await agents.create({ provider: 'codex', cwd: root, title: 'Проверка' });
  assert.equal(store.agent(a.id).native_id, 'native-test');
  await agents.message(a.id, 'Задача');
  await agents.message(a.id, 'Уточнение');
  assert.equal(rpc.calls.at(-1).method, 'turn/steer');
  assert.equal(rpc.calls.at(-1).params.expectedTurnId, 'turn-test');
  rpc.emit('request', {
    id: 10,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: 'native-test', command: 'npm test' },
  });
  assert.equal(store.agent(a.id).status, 'waiting');
  const prompt = agents.list()[0].pending[0];
  await agents.answer(prompt.id, { decision: 'decline' });
  assert.deepEqual(rpc.responses[0], { id: 10, value: { decision: 'decline' } });
  await agents.stop(a.id);
  assert.equal(rpc.calls.at(-1).method, 'turn/interrupt');
  assert.equal(rpc.calls.at(-1).params.turnId, 'turn-test');
  rpc.emit('notification', {
    method: 'turn/completed',
    params: { threadId: 'native-test', turn: { id: 'turn-test', status: 'interrupted' } },
  });
  assert.equal(agents.list()[0].canStop, false);
  assert.equal(store.agent(a.id).status, 'stopped');
  assert.equal(store.events(a.id).filter((e) => e.kind === 'user').length, 2);
  store.close();
});
test('unsupported requests fail closed and questions must have all answers', async () => {
  const store = new Store(':memory:'),
    rpc = new MockRPC(),
    agents = new Agents(store, rpc, files);
  const a = await agents.create({ provider: 'codex', cwd: root, title: 'Вопрос' });
  rpc.emit('request', { id: 22, method: 'item/tool/call', params: { threadId: a.native_id } });
  assert.deepEqual(rpc.rejections, [22]);
  rpc.emit('request', {
    id: 23,
    method: 'item/tool/requestUserInput',
    params: { threadId: a.native_id, questions: [{ id: 'q', question: 'Как?' }] },
  });
  const p = agents.list()[0].pending[0];
  await assert.rejects(agents.answer(p.id, { decision: 'accept', answers: {} }), /Ответьте/);
  await agents.answer(p.id, { decision: 'accept', answers: { q: 'Так' } });
  assert.deepEqual(rpc.responses.at(-1).value, { answers: { q: { answers: ['Так'] } } });
  store.close();
});
test('disconnects and restarts never replay a paid model request', async () => {
  const store = new Store(':memory:'),
    rpc = new MockRPC(),
    agents = new Agents(store, rpc, files);
  const a = await agents.create({ provider: 'codex', cwd: root, title: 'Связь' });
  await agents.message(a.id, 'Работай');
  rpc.emit('disconnected', 'connection closed');
  assert.equal(store.agent(a.id).status, 'disconnected');
  assert.equal(agents.list()[0].canStop, false);
  const fresh = new MockRPC();
  new Agents(store, fresh, files);
  assert.equal(fresh.calls.length, 0);
  store.close();
});
test('JSON-RPC handshake, errors and subprocess shutdown use the real transport', async () => {
  const fixture = path.join(temp, 'fake-server.mjs');
  await fs.writeFile(
    fixture,
    `import readline from 'node:readline';const rl=readline.createInterface({input:process.stdin});rl.on('line',l=>{const m=JSON.parse(l);if(!m.id)return;process.stdout.write(JSON.stringify(m.method==='fail'?{id:m.id,error:{code:-1,message:'fixture-error'}}:{id:m.id,result:{ok:true}})+'\\n')});`,
  );
  const rpc = new CodexRPC(process.execPath, [fixture]);
  try {
    const r = await rpc.call('test', {});
    assert.equal(r.ok, true);
    await assert.rejects(rpc.call('fail', {}), /fixture-error/);
  } finally {
    rpc.close();
  }
});
