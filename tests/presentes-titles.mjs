// Optional browser regression: pass an installed Playwright module path as argv[2].
// Uses only an in-memory HTTP catalog; no SQL, real credentials or remote calls.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const medals = ['Bronze', 'Prata', 'Ouro'].map((level, index) => ({
  id: String(index), name: `Presente Insano — Medalha ${level}`,
  slug: `moeda-${level.toLowerCase()}`, category: 'insanos', gift_type: 'insanos',
  funding_mode: 'fixed', target_amount: [75, 150, 225][index],
  description: 'Uma contribuição simbólica para seguir na estrada.',
  image_url: `/images/presentes/moeda-${level.toLowerCase()}-final.png`,
  active: true, featured: false, allow_multiple: true, display_order: index,
}));
const api = createServer((request, response) => {
  response.setHeader('Content-Type', 'application/json');
  if (!request.url.startsWith('/rest/v1/gifts?')) {
    response.writeHead(404).end('[]');
    return;
  }
  response.end(JSON.stringify(medals));
});
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
const databaseUrl = `http://127.0.0.1:${api.address().port}`;
const port = 3197;
const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', String(port)], {
  windowsHide: true, stdio: 'ignore',
  env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: databaseUrl, SUPABASE_URL: databaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-test-anon', SUPABASE_SERVICE_ROLE_KEY: 'local-test-only' },
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/presentes`, { signal: AbortSignal.timeout(2000) });
      if (response.ok) { ready = true; break; }
    } catch { /* Local app still starting. */ }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Local app did not start');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.hostname === '127.0.0.1' || url.protocol === 'data:' ? route.continue() : route.abort();
  });
  const output = process.argv[3];
  if (output) await mkdir(output, { recursive: true });
  for (const width of [375, 430, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto(`http://127.0.0.1:${port}/presentes`);
    await page.locator('article h3').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const titles = await page.locator('article h3').evaluateAll(elements => elements.map(title => {
      const card = title.closest('article').getBoundingClientRect();
      const walker = document.createTreeWalker(title, NodeFilter.SHOW_TEXT);
      const rects = [];
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        rects.push(...[...range.getClientRects()].filter(rect => rect.width > 0));
      }
      return {
        text: title.textContent,
        contained: rects.every(rect => rect.left >= card.left && rect.right <= card.right),
        lines: new Set(rects.map(rect => Math.round(rect.top))).size,
        wrap: getComputedStyle(title).whiteSpace,
        spanDisplay: getComputedStyle(title.querySelector('span')).display,
      };
    }));
    assert.equal(titles.length, 3);
    for (const [index, title] of titles.entries()) {
      assert.equal(title.text, medals[index].name.toUpperCase());
      assert.ok(title.contained, `${width}px: ${title.text} exceeds its card`);
      assert.equal(title.wrap, 'normal');
      if (width >= 768) assert.equal(title.lines, 2, `${width}px: expected two lines`);
      else assert.equal(title.spanDisplay, 'inline', 'Mobile must keep natural wrapping');
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (output) await page.locator('section[aria-labelledby="presentes-insanos-title"]').screenshot({ path: `${output}/insanos-${width}.png` });
    console.log(`${width}px: all three titles contained; ${titles.map(title => title.lines).join('/')} lines`);
  }
} finally {
  await browser?.close();
  app.kill();
  await new Promise(resolve => api.close(resolve));
}
