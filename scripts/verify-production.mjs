import { readFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const origin = 'https://snap-it-forget-it-api-extract.fmeconsultants1.workers.dev';
async function get(path) {
  const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response;
}
for (let attempt = 1; attempt <= 5; attempt++) {
  try {
    const health = await (await get('/health')).json();
    if (health.status !== 'ok' || health.db !== true) throw new Error('Database health failed');
    const version = await (await get('/version')).json();
    if (version.git_sha !== process.env.EXPECTED_SHA) throw new Error('Deployed SHA does not match');
    const expected = await readFile(new URL('../app/dist/index.html', import.meta.url), 'utf8');
    const actual = await (await get('/')).text();
    if (actual !== expected) throw new Error('Frontend does not match the validated build');
    for (const [, asset] of actual.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)) await get(asset);
    console.log('PASS: database health, deployed SHA, frontend and referenced assets');
    break;
  } catch (error) {
    if (attempt === 5) throw error;
    console.log(`Waiting for deployment: ${error.message}`);
    await setTimeout(5000);
  }
}
