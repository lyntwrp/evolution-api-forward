// Rebuild the bundled Manager from its exact upstream source plus the reviewed patch.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manager = path.join(root, 'evolution-manager-v2');
const expected = 'f054b9bc28083152d4948f835e3346fd0add39db';
const patch = path.join(__dirname, 'webhook-header-auth.patch');
const git = (...args) => execFileSync('git', args, { cwd: manager, encoding: 'utf8' }).trim();
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
if (git('rev-parse', 'HEAD') !== expected) throw new Error('Unexpected Manager revision');
if (git('status', '--porcelain')) throw new Error('Manager must be clean before building');
git('apply', '--check', patch);
git('apply', patch);
try {
  for (const args of [['ci', '--ignore-scripts', '--no-audit', '--no-fund'], ['run', 'build']]) {
    const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, {
      cwd: manager, stdio: 'inherit', shell: process.platform === 'win32',
    });
    if (result.status !== 0) throw new Error(`Manager command failed: npm ${args.join(' ')}`);
  }
  const source = path.join(manager, 'dist');
  const destination = path.join(root, 'manager', 'dist');
  if (!fs.existsSync(path.join(source, 'index.html'))) throw new Error('Build has no index.html');
  // Only replace this repository's generated bundle; refuse symlink redirection.
  for (const directory of [path.join(root, 'manager'), destination]) {
    if (fs.existsSync(directory) && fs.lstatSync(directory).isSymbolicLink()) throw new Error('Unsafe bundle path');
  }
  fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(source, destination, { recursive: true });
  // Vite retains checkout line endings in HTML; normalize the generated entry.
  const html = path.join(destination, 'index.html');
  fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace(/\r+\n/g, '\n'));
  const files = {};
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else files[path.relative(destination, file).replaceAll('\\', '/')] = hash(fs.readFileSync(file));
    }
  }
  walk(destination);
  const manifest = { upstream: expected, patchSha256: hash(fs.readFileSync(patch)), files };
  fs.writeFileSync(path.join(__dirname, 'bundle-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
} finally {
  git('apply', '--reverse', '--check', patch);
  git('apply', '--reverse', patch);
}
