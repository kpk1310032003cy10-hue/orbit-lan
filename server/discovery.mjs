import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { cleanPath } from './config.mjs';
import { within } from './files.mjs';

export class Discovery {
  constructor(config, rpc) {
    this.config = config;
    this.rpc = rpc;
  }
  list() {
    const dir = process.env.CODEX_HOME || path.join(os.homedir(), '.codex');
    let db;
    try {
      const file = fs
        .readdirSync(dir)
        .filter((x) => /^state_\d+\.sqlite$/.test(x))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))[0];
      if (!file) return { sessions: [], error: null };
      db = new DatabaseSync(path.join(dir, file), { readOnly: true });
      const rows = db
        .prepare(
          'SELECT id,cwd,title,source,updated_at,model,tokens_used,rollout_path FROM threads WHERE archived=0 ORDER BY updated_at DESC LIMIT 250',
        )
        .all();
      const sessions = rows
        .filter((r) =>
          this.config.roots.some((root) => within(cleanPath(root.path), cleanPath(r.cwd))),
        )
        .map((r) => ({
          id: r.id,
          cwd: cleanPath(r.cwd),
          title: (r.title || 'Диалог Codex').slice(0, 180),
          source: r.source.startsWith('{') ? 'subagent' : r.source,
          updated: r.updated_at * 1000,
          model: r.model,
          tokens: r.tokens_used,
          provider: 'codex',
          external: true,
          status: 'observed',
          canStop: false,
        }));
      return { sessions, error: null };
    } catch (e) {
      return { sessions: [], error: `История Codex: ${e.message}` };
    } finally {
      db?.close();
    }
  }
  get(id) {
    return this.list().sessions.find((x) => x.id === id);
  }
  async history(id, cursor) {
    if (!this.get(id))
      throw Object.assign(new Error('Сессия не найдена в рабочих папках'), { status: 404 });
    try {
      const result = await this.rpc.call('thread/items/list', {
        threadId: id,
        limit: 100,
        sortDirection: 'desc',
        ...(cursor ? { cursor } : {}),
      });
      return { items: result.data.reverse(), cursor: result.nextCursor, format: 'items' };
    } catch (e) {
      // Legacy Codex storage does not support item pagination. The read API handles that format.
      if (!/support|paginate|not found|not been|legacy|method/i.test(e.message)) throw e;
      const { thread } = await this.rpc.call('thread/read', { threadId: id, includeTurns: true });
      return {
        items: (thread.turns || [])
          .slice(-30)
          .flatMap((t) => t.items || [])
          .map((item) => ({ item })),
        cursor: null,
        format: 'items',
      };
    }
  }
}
