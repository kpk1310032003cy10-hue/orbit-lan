import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { cleanPath, stateDir } from './config.mjs';

const forbidden =
  /^(?:\.git|\.ssh|\.aws|\.azure|\.codex|\.claude|\.sandbox.*|node_modules|\.env(?:\..*)?|.*\.(?:pem|key|pfx|p12)|(?:auth|credentials|secrets)\.json)$/i;
export const isForbidden = (p) => p.split(/[\\/]/).some((x) => forbidden.test(x));
export const within = (root, target) => {
  const rel = path.relative(root, target);
  return !rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel);
};
const error = (message, status = 400) => Object.assign(new Error(message), { status });
export class Files {
  constructor(config) {
    this.config = config;
  }
  async resolve(rootId, relative = '') {
    const root = this.config.roots.find((r) => r.id === rootId);
    if (!root) throw error('Рабочая папка не найдена', 404);
    if (
      typeof relative !== 'string' ||
      relative.includes('\0') ||
      path.isAbsolute(relative) ||
      relative.includes(':') ||
      isForbidden(relative)
    )
      throw error('Доступ к этому пути закрыт', 403);
    const rootPath = await fs.realpath(cleanPath(root.path));
    const candidate = path.resolve(rootPath, relative);
    if (!within(rootPath, candidate)) throw error('Путь за пределами рабочей папки', 403);
    const real = await fs.realpath(candidate);
    if (
      !within(rootPath, real) ||
      within(stateDir, real) ||
      isForbidden(path.relative(rootPath, real))
    )
      throw error('Ссылка ведёт за пределы разрешённой области', 403);
    return { root, rootPath, full: real, relative: path.relative(rootPath, real) };
  }
  async validateCwd(cwd) {
    const full = await fs.realpath(cleanPath(cwd));
    for (const root of this.config.roots) {
      const rootPath = await fs.realpath(cleanPath(root.path));
      if (
        within(rootPath, full) &&
        !isForbidden(path.relative(rootPath, full)) &&
        (await fs.stat(full)).isDirectory()
      )
        return full;
    }
    throw error('Выберите каталог внутри подключённых рабочих папок', 403);
  }
  async list(root, relative) {
    const resolved = await this.resolve(root, relative);
    const entries = await fs.readdir(resolved.full, { withFileTypes: true });
    const items = await Promise.all(
      entries
        .filter((x) => !forbidden.test(x.name))
        .slice(0, 600)
        .map(async (e) => {
          const info = await fs.lstat(path.join(resolved.full, e.name));
          return {
            name: e.name,
            directory: e.isDirectory(),
            link: e.isSymbolicLink(),
            size: info.size,
            modified: info.mtimeMs,
            path: path.join(resolved.relative, e.name).replaceAll('\\', '/'),
          };
        }),
    );
    return {
      path: resolved.relative.replaceAll('\\', '/'),
      fullPath: resolved.full,
      items: items.sort(
        (a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name, 'ru'),
      ),
      truncated: entries.length > 600,
    };
  }
  async read(root, relative) {
    const { full } = await this.resolve(root, relative);
    const stat = await fs.stat(full);
    if (!stat.isFile()) throw error('Выберите файл');
    if (stat.size > 1024 * 1024)
      throw error('Для просмотра доступны текстовые файлы до 1 МБ. Файл можно скачать.');
    const buffer = await fs.readFile(full);
    if (buffer.includes(0)) throw error('Двоичный файл можно скачать');
    return {
      content: buffer.toString('utf8'),
      version: createHash('sha256').update(buffer).digest('hex'),
      size: stat.size,
    };
  }
  async write(root, relative, content, version) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > 1024 * 1024)
      throw error('Максимальный размер текста — 1 МБ');
    const { full } = await this.resolve(root, relative);
    const current = await this.read(root, relative);
    if (current.version !== version)
      throw error('Файл изменился на компьютере. Откройте его заново перед сохранением.', 409);
    // Keep an independent backup before each edit; the existing file is never deleted.
    const backupDir = path.join(stateDir, 'backups');
    await fs.mkdir(backupDir, { recursive: true });
    const backupName = `${Date.now()}-${createHash('sha256').update(full).digest('hex').slice(0, 12)}.bak`;
    await fs.copyFile(full, path.join(backupDir, backupName));
    await fs.writeFile(full, content, 'utf8');
    return this.read(root, relative);
  }
}
