import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

// Check the Git index, which is the exact set of files about to be published.
const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', windowsHide: true })
  .split('\0')
  .filter(Boolean);
const forbiddenPath =
  /(?:^|\/)(?:node_modules|\.local|test-results|coverage|tls|backups|\.codex|\.claude)(?:\/|$)|(?:^|\/)(?:\.env(?:\..*)?|auth\.json|credentials\.json|runtime\.json)$|\.(?:pem|key|crt|pfx|p12|sqlite(?:-wal|-shm)?)$/i;
const patterns = [
  ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{35,})\b/],
  ['provider API key', /\bsk-(?:proj-|ant-api\d+-)?[A-Za-z0-9_-]{24,}/],
  ['personal home directory', /\b[A-Z]:[\\/]Users[\\/][^\s<>'"\\/]+[\\/]/i],
];
const problems = [];
for (const file of files) {
  if (forbiddenPath.test(file)) problems.push(`${file}: runtime or credential file`);
  const data = fs.readFileSync(file);
  if (data.includes(0) || data.length > 2_000_000) continue;
  const content = data.toString('utf8');
  for (const [name, pattern] of patterns)
    if (pattern.test(content)) problems.push(`${file}: ${name}`);
}
if (problems.length) {
  // Report only locations and categories; never echo a potential secret.
  console.error(problems.join('\n'));
  process.exit(1);
}
console.log(
  `Publication guard passed: ${files.length} tracked files. This check complements manual review.`,
);
