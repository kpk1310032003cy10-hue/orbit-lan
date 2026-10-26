import test from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown, resolveFileReference } from '../public/markdown.js';
import { transcriptModel } from '../public/chat.js';

test('chat prose renders emphasis, nested lists, links, quotes, tasks and tables', () => {
  const html = renderMarkdown(
    '**Главное** и *уточнение*.\n\n- Первый\n  - Вложенный\n- [x] Готово\n\n> Цитата\n\n[Источник](https://example.com/docs)\n\n| Имя | Остаток |\n|:---|---:|\n| A | 72% |',
  );
  for (const tag of [
    '<strong>Главное</strong>',
    '<em>уточнение</em>',
    '<blockquote>',
    '<table>',
    'scope="col"',
    'align-right',
    'task-marker checked',
  ])
    assert.ok(html.includes(tag), tag);
  assert.ok(html.includes('target="_blank" rel="noopener noreferrer"'));
  assert.equal(/\sstyle=/.test(html), false, 'Table alignment works under the actual CSP');
});

test('untrusted messages cannot introduce HTML, executable URLs, active controls or tracking images', () => {
  const probes = [
    '<script>window.compromised=1</script>',
    '<img src=x onerror=alert(1)>',
    '<svg/onload=alert(1)>',
    '<iframe src="https://example.com"></iframe>',
    '[опасно](javascript:alert(1))',
    '[опасно](javascript&#x3a;alert(1))',
    '[опасно](data:text/html,test)',
    '[опасно](vbscript:msgbox(1))',
    '[опасно](file:///C:/Windows/system.ini)',
    '[опасно](https://user:password@example.com)',
    '[опасно](//example.com)',
  ];
  for (const probe of probes) {
    const html = renderMarkdown(probe);
    assert.equal(/<(script|img|svg|iframe|input|form)\b/i.test(html), false, probe);
    assert.equal(/href=["'](?:javascript|data|vbscript|file):/i.test(html), false, probe);
    assert.equal(/href=["']https:\/\/user:password@/i.test(html), false);
  }
  const image = renderMarkdown('![схема](https://example.com/tracking.png)');
  assert.equal(image.includes('<img'), false);
  assert.ok(image.includes('Изображение: схема'));
});

test('code is highlighted only as text, survives unfinished fences and remains complete for copying', () => {
  const html = renderMarkdown('```javascript\nconst html = "<img src=x onerror=alert(1)>";\n');
  assert.ok(html.includes('hljs-keyword'));
  assert.ok(html.includes('Копировать код'));
  assert.equal(html.includes('<img'), false);
  const hostile = renderMarkdown('```"><script>\n<svg onload=alert(1)>\n```');
  assert.equal(hostile.includes('<script>'), false);
  assert.equal(hostile.includes('<svg'), false);
  const long = 'x'.repeat(250001);
  assert.ok(renderMarkdown(long).includes(long));
});

test('file references resolve lines within configured roots and reject traversal, network paths and streams', () => {
  const roots = [{ id: 'project', path: 'C:/Projects/Demo' }];
  assert.deepEqual(resolveFileReference('README.md:12', 'C:/Projects/Demo', roots), {
    root: 'project',
    path: 'README.md',
    line: 12,
  });
  assert.deepEqual(resolveFileReference('/C:/Projects/Demo/src/app.js#L7', '', roots), {
    root: 'project',
    path: 'src/app.js',
    line: 7,
  });
  assert.ok(renderMarkdown('[файл](README.md:12)').includes('data-a="file-reference"'));
  for (const path of [
    '../../Windows/system.ini',
    'C:/Projects/Demo-other/file.txt',
    '//server/share/file',
    'C:/Projects/Demo/file.txt:secret',
    '%00bad.md',
    'javascript:alert(1)',
    'file:///C:/Projects/Demo/file.txt',
    'https://example.com/app.js',
  ])
    assert.equal(resolveFileReference(path, 'C:/Projects/Demo', roots), null, path);
});

test('streamed deltas and their final item are one stable message; history prepends retain identities', () => {
  const events = [
    { seq: 20, kind: 'user', payload: { text: 'Вопрос' }, created: 1000 },
    { seq: 21, kind: 'delta', payload: { itemId: 'answer', text: '**От' } },
    { seq: 22, kind: 'delta', payload: { itemId: 'answer', text: 'вет**' } },
    {
      seq: 23,
      kind: 'item',
      payload: { item: { id: 'answer', type: 'agentMessage', text: '**Ответ**', phase: 'final' } },
    },
  ];
  const original = transcriptModel(events);
  assert.equal(original.length, 2);
  assert.equal(original[1].text, '**Ответ**');
  const older = transcriptModel([
    { seq: 1, kind: 'assistant', payload: { text: 'Ранее' } },
    ...events,
  ]);
  assert.deepEqual(
    older.slice(1).map((m) => m.id),
    original.map((m) => m.id),
  );
  const log = transcriptModel([
    { seq: 1, kind: 'output', payload: { text: 'a' } },
    { seq: 2, kind: 'output', payload: { text: 'b' } },
  ]);
  assert.equal(log.length, 1);
  assert.equal(log[0].text, 'ab');
});
