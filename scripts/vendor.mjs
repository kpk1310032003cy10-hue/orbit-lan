import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const languages = [
  'bash',
  'css',
  'diff',
  'javascript',
  'json',
  'markdown',
  'powershell',
  'python',
  'sql',
  'typescript',
  'xml',
  'yaml',
];
const files = [
  ['markdown-it/dist/browser/markdown-it.esm.min.mjs', 'markdown-it.js'],
  ['markdown-it/LICENSE', 'markdown-it.LICENSE.txt'],
  ['@highlightjs/cdn-assets/es/core.min.js', 'highlight.js'],
  ['@highlightjs/cdn-assets/LICENSE', 'highlight.LICENSE.txt'],
  ['mdurl/LICENSE', 'licenses/mdurl.txt'],
  ['uc.micro/LICENSE.txt', 'licenses/uc.micro.txt'],
  ['entities/LICENSE', 'licenses/entities.txt'],
  ['linkify-it/LICENSE', 'licenses/linkify-it.txt'],
  ['punycode.js/LICENSE-MIT.txt', 'licenses/punycode.js.txt'],
  ...languages.map((language) => [
    `@highlightjs/cdn-assets/es/languages/${language}.min.js`,
    `highlight/${language}.js`,
  ]),
];
for (const [source, target] of files) {
  let content = await fs.readFile(path.join(root, 'node_modules', source), 'utf8');
  if (target.endsWith('.js'))
    content = content.replace(/^\/\/[#@]\s*sourceMappingURL=.*$/gm, '').trimEnd() + '\n';
  const destination = path.join(root, 'public/vendor', target);
  if (process.argv.includes('--check')) {
    const actual = await fs.readFile(destination, 'utf8').catch(() => '');
    if (actual !== content)
      throw new Error(`Browser vendor asset is outdated: ${target}. Run npm run vendor.`);
  } else {
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, content);
  }
}
console.log(
  `Browser dependencies ${process.argv.includes('--check') ? 'verified' : 'copied'}: ${files.length} files.`,
);
