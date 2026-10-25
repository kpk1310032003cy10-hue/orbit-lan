import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { stateDir } from './config.mjs';

export class Store {
  constructor(filename = path.join(stateDir, 'orbit.sqlite')) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, csrf TEXT NOT NULL, created INTEGER, seen INTEGER, expires INTEGER);
      CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, provider TEXT NOT NULL, native_id TEXT, title TEXT NOT NULL, cwd TEXT NOT NULL, status TEXT, created INTEGER, updated INTEGER);
      CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT, kind TEXT NOT NULL, payload TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS event_agent ON events(agent_id, seq);
      CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT, detail TEXT, created INTEGER);`);
  }
  agents() {
    return this.db.prepare('SELECT * FROM agents ORDER BY updated DESC').all();
  }
  agent(id) {
    return this.db.prepare('SELECT * FROM agents WHERE id=?').get(id);
  }
  createAgent(provider, title, cwd) {
    const now = Date.now();
    const id = randomUUID();
    this.db
      .prepare('INSERT INTO agents VALUES(?,?,?,?,?,?,?,?)')
      .run(id, provider, null, title, cwd, 'idle', now, now);
    return this.agent(id);
  }
  updateAgent(id, patch) {
    for (const [key, value] of Object.entries(patch)) {
      if (['native_id', 'title', 'status', 'cwd'].includes(key))
        this.db
          .prepare(`UPDATE agents SET ${key}=?,updated=? WHERE id=?`)
          .run(value, Date.now(), id);
    }
  }
  event(agentId, kind, payload) {
    const created = Date.now();
    const r = this.db
      .prepare('INSERT INTO events(agent_id,kind,payload,created) VALUES(?,?,?,?)')
      .run(agentId, kind, JSON.stringify(payload), created);
    return { seq: Number(r.lastInsertRowid), agentId, kind, payload, created };
  }
  events(agentId, before = Number.MAX_SAFE_INTEGER) {
    return this.db
      .prepare('SELECT * FROM events WHERE agent_id=? AND seq<? ORDER BY seq DESC LIMIT 300')
      .all(agentId, before)
      .reverse()
      .map((x) => ({
        seq: x.seq,
        agentId: x.agent_id,
        kind: x.kind,
        payload: JSON.parse(x.payload),
        created: x.created,
      }));
  }
  audit(action, detail) {
    this.db
      .prepare('INSERT INTO audit(action,detail,created) VALUES(?,?,?)')
      .run(action, JSON.stringify(detail), Date.now());
  }
  history() {
    return this.db
      .prepare('SELECT * FROM audit ORDER BY seq DESC LIMIT 60')
      .all()
      .map((x) => ({ ...x, detail: JSON.parse(x.detail) }));
  }
  close() {
    this.db.close();
  }
}
