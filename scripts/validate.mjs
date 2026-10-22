import { access, readFile } from 'node:fs/promises';

const scriptPath = new URL('../Unity_Auto_Redeemer.user.js', import.meta.url);
const source = await readFile(scriptPath, 'utf8');
const blocks = source.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/g) || [];
if (blocks.length !== 1) throw new Error(`Expected one metadata block, found ${blocks.length}`);
for (const marker of ['// ==UserScript==', '// ==/UserScript==']) {
  if (source.split(marker).length !== 2) throw new Error(`Duplicate or missing metadata marker: ${marker}`);
}

const fields = new Map();
for (const match of blocks[0].matchAll(/^\/\/\s+@(\S+)\s+(.+)$/gm)) {
  if (fields.has(match[1])) throw new Error(`Duplicate metadata field: @${match[1]}`);
  fields.set(match[1], match[2].trim());
}

const expected = {
  name: 'Unity Asset Redeemer',
  namespace: 'https://github.com/PatrickJnr/Unity-Asset-Redeemer',
  license: 'CC-BY-NC-SA-4.0',
  homepageURL: 'https://github.com/PatrickJnr/Unity-Asset-Redeemer',
  supportURL: 'https://github.com/PatrickJnr/Unity-Asset-Redeemer/issues',
  updateURL: 'https://raw.githubusercontent.com/PatrickJnr/Unity-Asset-Redeemer/main/Unity_Auto_Redeemer.user.js',
  downloadURL: 'https://raw.githubusercontent.com/PatrickJnr/Unity-Asset-Redeemer/main/Unity_Auto_Redeemer.user.js',
  match: 'https://assetstore.unity.com/*',
  'run-at': 'document-idle',
  grant: 'none'
};
for (const [key, value] of Object.entries(expected)) {
  if (fields.get(key) !== value) throw new Error(`Invalid or missing @${key}`);
}
if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(fields.get('version') || '')) throw new Error('Invalid semantic @version');
if (!fields.has('description') || !fields.has('author')) throw new Error('Missing description or author');

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const version = fields.get('version');
if (packageJson.version !== version) throw new Error('package.json and userscript versions differ');
const lock = JSON.parse(await readFile(new URL('../package-lock.json', import.meta.url), 'utf8'));
if (lock.version !== version || lock.packages[''].version !== version) throw new Error('Lockfile version differs');
if (!source.includes(`<span class="version">v${version}</span>`)) throw new Error('Dashboard version differs');
const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
if (!readme.includes(`Current version: **${version}**`)) throw new Error('README version differs');
if (!readme.includes(`](${expected.downloadURL})`)) throw new Error('README install link differs');
const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
if (changelog.match(/^## \[([^\]]+)\] - \d{4}-\d{2}-\d{2}$/m)?.[1] !== version) throw new Error('Latest changelog version differs');
if (!changelog.includes(`[${version}]: ${expected.homepageURL}/releases/tag/v${version}`)) throw new Error('Changelog release link differs');
for (const filename of ['README.md', 'CONTRIBUTING.md', 'ATTRIBUTION.md', 'CHANGELOG.md']) {
  const url = new URL(`../${filename}`, import.meta.url);
  const markdown = await readFile(url, 'utf8');
  for (const [, target] of markdown.matchAll(/!?\[[^\]]+\]\(([^\s)]+)\)/g)) {
    if (/^(?:[a-z][a-z\d+.-]*:|#)/i.test(target)) continue;
    const file = new URL(target, url);
    file.hash = '';
    await access(file).catch(() => { throw new Error(`Broken local link in ${filename}: ${target}`); });
  }
}
console.log(`Metadata, release versions and local documentation links valid for Unity Asset Redeemer v${version}`);
