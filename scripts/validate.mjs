import { readFile } from 'node:fs/promises';

const scriptPath = new URL('../Unity_Auto_Redeemer.user.js', import.meta.url);
const source = await readFile(scriptPath, 'utf8');
const blocks = source.match(/\/\/ ==UserScript==[\s\S]*?\/\/ ==\/UserScript==/g) || [];
if (blocks.length !== 1) throw new Error(`Expected one metadata block, found ${blocks.length}`);

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
if (!/^\d+\.\d+\.\d+$/.test(fields.get('version') || '')) throw new Error('Invalid semantic @version');
if (!fields.has('description') || !fields.has('author')) throw new Error('Missing description or author');

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
if (packageJson.version !== fields.get('version')) throw new Error('package.json and userscript versions differ');
console.log(`Metadata valid for Unity Asset Redeemer v${fields.get('version')}`);
