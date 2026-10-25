import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

const err = (text, status = 400) => Object.assign(new Error(text), { status });
export class Agents extends EventEmitter {
  constructor(store, rpc, files) {
    super();
    this.store = store;
    this.rpc = rpc;
    this.files = files;
    this.running = new Map();
    this.prompts = new Map();
    this.loaded = new Set();
    this.locks = new Set();
    // A restart never silently replays a prompt or starts paid work.
    for (const a of store.agents())
      if (['running', 'waiting', 'starting', 'stopping'].includes(a.status))
        store.updateAgent(a.id, { status: 'disconnected' });
    rpc.on('notification', (m) => this.notification(m));
    rpc.on('request', (m) => this.request(m));
    rpc.on('disconnected', (message) => {
      this.loaded.clear();
      for (const [id, run] of this.running)
        if (run.provider === 'codex') {
          this.running.delete(id);
          this.status(id, 'disconnected');
          this.event(id, 'error', { text: message });
          this.clearPrompts(id);
        }
    });
  }
  event(id, kind, payload) {
    const e = this.store.event(id, kind, payload);
    this.emit('event', e);
    return e;
  }
  status(id, status) {
    this.store.updateAgent(id, { status });
    this.event(id, 'status', { status });
  }
  byNative(id) {
    return this.store.agents().find((a) => a.native_id === id);
  }
  list() {
    return this.store.agents().map((a) => ({
      ...a,
      canStop: this.running.has(a.id),
      pending: [...this.prompts.values()]
        .filter((p) => p.agentId === a.id)
        .map((p) => this.publicPrompt(p)),
    }));
  }
  async create({ provider, title, cwd, forkId }) {
    if (!['codex', 'claude'].includes(provider)) throw err('Неизвестный агент');
    cwd = await this.files.validateCwd(cwd);
    if (typeof title !== 'string' || !title.trim() || title.length > 160)
      throw err('Укажите название до 160 символов');
    const agent = this.store.createAgent(provider, title.trim(), cwd);
    try {
      if (provider === 'codex') {
        const options = {
          cwd,
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
          sandbox: 'workspace-write',
          serviceName: 'orbit-lan',
          ...(forkId ? { threadId: forkId, excludeTurns: true } : {}),
        };
        const { thread } = await this.rpc.call(forkId ? 'thread/fork' : 'thread/start', options);
        this.store.updateAgent(agent.id, { native_id: thread.id });
        this.loaded.add(agent.id);
      }
      this.event(agent.id, 'system', {
        text: forkId
          ? 'Создана отдельная ветка с историей. Исходный диалог сохранён.'
          : 'Сессия готова. Напишите задачу.',
      });
      this.store.audit('agent.created', { id: agent.id, provider, cwd, forkId: forkId || null });
      return this.store.agent(agent.id);
    } catch (e) {
      this.status(agent.id, 'failed');
      this.event(agent.id, 'error', { text: e.message });
      throw e;
    }
  }
  async message(id, text) {
    const a = this.store.agent(id);
    if (!a) throw err('Сессия не найдена', 404);
    if (typeof text !== 'string' || !text.trim() || text.length > 32000)
      throw err('Сообщение должно содержать от 1 до 32000 символов');
    if (this.locks.has(id)) throw err('Предыдущее действие ещё обрабатывается', 409);
    await this.files.validateCwd(a.cwd);
    this.locks.add(id);
    try {
      if (a.provider === 'codex') {
        const active = this.running.get(id);
        if (active) {
          if (!active.turnId || a.status === 'waiting')
            throw err('Сначала ответьте на запрос агента или остановите его', 409);
          await this.rpc.call('turn/steer', {
            threadId: a.native_id,
            expectedTurnId: active.turnId,
            input: [{ type: 'text', text }],
          });
          this.event(id, 'user', { text });
          return { steered: true };
        }
        if (this.running.size >= 4)
          throw err('Уже работают четыре агента. Дождитесь завершения одного.', 409);
        if (!this.loaded.has(id)) {
          await this.rpc.call('thread/resume', {
            threadId: a.native_id,
            cwd: a.cwd,
            excludeTurns: true,
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
            sandbox: 'workspace-write',
          });
          this.loaded.add(id);
        }
        this.running.set(id, { provider: 'codex', turnId: null });
        this.status(id, 'starting');
        this.event(id, 'user', { text });
        const { turn } = await this.rpc.call('turn/start', {
          threadId: a.native_id,
          input: [{ type: 'text', text }],
        });
        const run = this.running.get(id);
        if (run) {
          run.turnId = turn.id;
          this.status(id, 'running');
        }
      } else {
        if (this.running.has(id))
          throw err('Claude ещё отвечает. Дождитесь ответа или остановите задачу.', 409);
        if (this.running.size >= 4) throw err('Уже работают четыре агента', 409);
        this.event(id, 'user', { text });
        this.status(id, 'starting');
        const run = { provider: 'claude', controller: new AbortController(), query: null };
        this.running.set(id, run);
        this.claude(a, text, run)
          .catch((e) => {
            this.event(id, 'error', { text: e.message });
            this.status(id, 'failed');
          })
          .finally(() => {
            this.running.delete(id);
            this.clearPrompts(id);
          });
      }
      this.store.audit('agent.message', { id });
      return { accepted: true };
    } catch (e) {
      if (a.provider === 'codex' && this.running.get(id)?.turnId === null) {
        this.running.delete(id);
        this.status(id, 'failed');
        this.event(id, 'error', { text: e.message });
      }
      throw e;
    } finally {
      this.locks.delete(id);
    }
  }
  async stop(id) {
    const a = this.store.agent(id),
      run = this.running.get(id);
    if (!a || !run) throw err('У этой сессии нет выполняемой задачи', 409);
    if (run.provider === 'codex') {
      if (!run.turnId) throw err('Задача запускается. Повторите остановку через секунду.', 409);
      await this.rpc.call('turn/interrupt', { threadId: a.native_id, turnId: run.turnId });
    } else {
      run.controller.abort();
    }
    if (this.running.has(id)) this.status(id, 'stopping');
    this.store.audit('agent.stop', { id });
  }
  notification({ method, params: p = {} }) {
    const a = this.byNative(p.threadId || p.thread?.id);
    if (!a) return;
    const id = a.id;
    if (method === 'turn/started') {
      this.running.set(id, { provider: 'codex', turnId: p.turn.id });
      this.status(id, 'running');
    } else if (method === 'turn/completed') {
      this.running.delete(id);
      this.clearPrompts(id);
      this.status(
        id,
        p.turn.status === 'interrupted'
          ? 'stopped'
          : p.turn.status === 'failed'
            ? 'failed'
            : 'idle',
      );
      if (p.turn.error) this.event(id, 'error', { text: p.turn.error.message });
      this.event(id, 'completed', { status: p.turn.status });
    } else if (method === 'item/agentMessage/delta')
      this.event(id, 'delta', { itemId: p.itemId, text: p.delta });
    else if (method === 'item/started' || method === 'item/completed')
      this.event(id, 'item', {
        phase: method.endsWith('started') ? 'started' : 'completed',
        item: p.item,
      });
    else if (method === 'item/commandExecution/outputDelta')
      this.event(id, 'output', { itemId: p.itemId, text: p.delta });
    else if (method === 'turn/plan/updated')
      this.event(id, 'plan', { plan: p.plan, explanation: p.explanation });
    else if (method === 'thread/tokenUsage/updated')
      this.event(id, 'usage', { usage: p.tokenUsage });
    else if (method === 'error')
      this.event(id, 'error', { text: p.error?.message || 'Ошибка Codex' });
    else if (method === 'serverRequest/resolved') {
      for (const [key, value] of this.prompts)
        if (value.rpcId === p.requestId) {
          this.prompts.delete(key);
          this.event(id, 'prompt.resolved', { id: key });
        }
    }
  }
  publicPrompt(p) {
    return { id: p.id, agentId: p.agentId, method: p.method, details: p.details };
  }
  request(m) {
    const a = this.byNative(m.params?.threadId);
    if (!a) return this.rpc.reject(m.id, 'Сессия не принадлежит Орбите');
    const supported = [
      'item/commandExecution/requestApproval',
      'item/fileChange/requestApproval',
      'item/tool/requestUserInput',
      'item/permissions/requestApproval',
      'mcpServer/elicitation/request',
    ];
    if (!supported.includes(m.method)) {
      this.rpc.reject(m.id);
      this.event(a.id, 'error', {
        text: `Неподдерживаемый запрос: ${m.method}. Действие отклонено.`,
      });
      return;
    }
    const prompt = {
      id: randomUUID(),
      rpcId: m.id,
      agentId: a.id,
      method: m.method,
      details: m.params,
    };
    this.prompts.set(prompt.id, prompt);
    this.status(a.id, 'waiting');
    this.event(a.id, 'prompt', this.publicPrompt(prompt));
  }
  async answer(id, { decision, answers, content }) {
    const p = this.prompts.get(id);
    if (!p) throw err('Запрос уже закрыт', 409);
    if (!['accept', 'decline', 'cancel'].includes(decision)) throw err('Неизвестное решение');
    let result;
    if (p.method === 'claude/question') {
      if (decision !== 'accept') throw err('Ответьте на вопрос или остановите агента');
      const values = {};
      for (const q of p.details.questions || []) {
        const value = answers?.[q.question];
        if (typeof value !== 'string' || !value.trim()) throw err('Ответьте на все вопросы');
        values[q.question] = value.slice(0, 4000);
      }
      result = { behavior: 'allow', updatedInput: { ...p.details.input, answers: values } };
    } else if (p.method === 'claude/permission')
      result =
        decision === 'accept'
          ? { behavior: 'allow', updatedInput: p.details.input }
          : { behavior: 'deny', message: 'Пользователь отклонил действие' };
    else if (p.method === 'item/tool/requestUserInput') {
      if (decision !== 'accept') throw err('Ответьте на вопрос или остановите агента');
      result = { answers: {} };
      for (const q of p.details.questions || []) {
        const value = answers?.[q.id];
        if (typeof value !== 'string' || !value.trim()) throw err('Ответьте на все вопросы');
        result.answers[q.id] = { answers: [value.slice(0, 4000)] };
      }
    } else if (p.method === 'item/permissions/requestApproval')
      result = { permissions: decision === 'accept' ? p.details.permissions : {}, scope: 'turn' };
    else if (p.method === 'mcpServer/elicitation/request') {
      if (p.details.mode === 'url' && decision === 'accept')
        throw err('Внешняя авторизация требует отдельного клиента; отклоните запрос.');
      result = { action: decision, content: decision === 'accept' ? content || {} : null };
    } else
      result = {
        decision: decision === 'accept' ? 'accept' : decision === 'decline' ? 'decline' : 'cancel',
      };
    if (p.resolve) p.resolve(result);
    else this.rpc.respond(p.rpcId, result);
    this.prompts.delete(id);
    this.event(p.agentId, 'prompt.resolved', { id });
    this.status(p.agentId, 'running');
    this.store.audit('agent.approval', { id: p.agentId, method: p.method, decision });
  }
  clearPrompts(id) {
    for (const [key, p] of this.prompts)
      if (p.agentId === id) {
        p.resolve?.({ behavior: 'deny', message: 'Задача остановлена' });
        this.prompts.delete(key);
        this.event(id, 'prompt.resolved', { id: key });
      }
  }
  async claude(a, text, run) {
    const { query } = await import('@anthropic-ai/claude-agent-sdk');
    const q = query({
      prompt: text,
      options: {
        cwd: a.cwd,
        ...(a.native_id ? { resume: a.native_id } : {}),
        abortController: run.controller,
        permissionMode: 'default',
        includePartialMessages: true,
        settingSources: ['user', 'project', 'local'],
        canUseTool: async (tool, input, context) =>
          new Promise((resolve) => {
            const p = {
              id: randomUUID(),
              agentId: a.id,
              method: tool === 'AskUserQuestion' ? 'claude/question' : 'claude/permission',
              details: {
                tool,
                input,
                ...(tool === 'AskUserQuestion' ? { questions: input.questions } : {}),
              },
              resolve,
            };
            if (run.controller.signal.aborted)
              return resolve({ behavior: 'deny', message: 'Задача остановлена' });
            const abort = () => {
              this.prompts.delete(p.id);
              resolve({ behavior: 'deny', message: 'Задача остановлена' });
            };
            context.signal?.addEventListener('abort', abort, { once: true });
            p.resolve = (value) => {
              context.signal?.removeEventListener('abort', abort);
              resolve(value);
            };
            this.prompts.set(p.id, p);
            this.status(a.id, 'waiting');
            this.event(a.id, 'prompt', this.publicPrompt(p));
          }),
      },
    });
    run.query = q;
    this.status(a.id, 'running');
    let claudeMessageId = null;
    try {
      for await (const m of q) {
        if (m.type === 'rate_limit_event')
          this.emit('rateLimits', { provider: 'claude', info: m.rate_limit_info });
        if (m.type === 'system' && m.subtype === 'init')
          this.store.updateAgent(a.id, { native_id: m.session_id });
        if (m.type === 'stream_event') {
          if (m.event.type === 'message_start') claudeMessageId = m.event.message.id;
          if (m.event.type === 'content_block_delta' && m.event.delta.type === 'text_delta')
            this.event(a.id, 'delta', {
              itemId: `${claudeMessageId}-${m.event.index}`,
              text: m.event.delta.text,
            });
        }
        if (m.type === 'assistant')
          for (const [index, block] of m.message.content.entries()) {
            if (block.type === 'text')
              this.event(a.id, 'item', {
                phase: 'completed',
                item: { id: `${m.message.id}-${index}`, type: 'agentMessage', text: block.text },
              });
            else if (block.type === 'tool_use')
              this.event(a.id, 'tool', { name: block.name, input: block.input });
          }
        if (m.type === 'result') {
          if (m.is_error)
            this.event(a.id, 'error', {
              text:
                m.errors?.join('\n') ||
                m.result ||
                'Claude завершился с ошибкой. Проверьте вход в аккаунт.',
            });
          this.status(a.id, m.is_error ? 'failed' : 'idle');
          this.event(a.id, 'completed', {
            status: m.is_error ? 'failed' : 'completed',
            cost: m.total_cost_usd,
            usage: m.usage,
          });
        }
      }
    } catch (e) {
      if (!run.controller.signal.aborted) throw e;
    } finally {
      q.close();
      if (run.controller.signal.aborted) {
        this.status(a.id, 'stopped');
        this.event(a.id, 'completed', { status: 'interrupted' });
      }
    }
  }
  async close() {
    for (const [id] of this.running) {
      try {
        await this.stop(id);
      } catch {}
    }
    this.rpc.close();
  }
}
