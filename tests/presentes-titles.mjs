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
const regular = [
  ['zero', 'Docinhos finos', 'party', 'goal', 600],
  ['partial', 'Nossa geladeira', 'house', 'goal', 3500],
  ['reached', 'Nossa hospedagem em Gramado', 'travel', 'goal', 2500],
  ['open', 'Uma ajudinha com os últimos boletos 😅', 'party', 'open', null],
  ['fixed', 'Presente fixo de teste', 'house', 'fixed', 150],
  ['negative', 'Limite inferior de teste', 'house', 'goal', 600],
  ['above', 'Limite superior de teste', 'house', 'goal', 600],
  ['missing', 'Progresso ausente', 'house', 'goal', 600],
].map(([id, name, category, funding_mode, target_amount], display_order) => ({
  id, name, category, funding_mode, target_amount, slug: id, display_order,
  gift_type: 'regular', image_url: id === 'zero' ? '/images/casal/pe-26.jpg' : null,
  description: 'Descrição de teste local.',
  active: true, featured: false, allow_multiple: true,
}));
const progress = regular.filter(gift => gift.id !== 'missing').map(gift => ({
  gift_id: gift.id, target_amount: gift.target_amount,
  total_raised: gift.id === 'partial' ? '1225' : gift.id === 'reached' ? '2500' : gift.funding_mode !== 'goal' ? '98765' : '0',
  percentage: gift.id === 'partial' ? '35' : gift.id === 'reached' ? 100 : gift.id === 'negative' ? -5 : gift.id === 'above' ? 125 : 0,
  remaining_amount: gift.id === 'partial' ? '2275' : gift.id === 'reached' ? 0 : gift.target_amount,
  goal_reached: gift.id === 'reached',
})).reverse();
let progressAvailable = true;
const requests = [];
const api = createServer((request, response) => {
  requests.push({ method: request.method, path: request.url });
  response.setHeader('Content-Type', 'application/json');
  if (request.url === '/rest/v1/rpc/get_gift_progress') {
    response.writeHead(progressAvailable ? 200 : 503).end(JSON.stringify(progressAvailable ? progress : {}));
    return;
  }
  if (!request.url.startsWith('/rest/v1/gifts?')) {
    response.writeHead(404).end('[]');
    return;
  }
  response.end(JSON.stringify([...regular, ...medals]));
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
  for (const width of [375, 390, 430, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto(`http://127.0.0.1:${port}/presentes`);
    await page.locator('article h3').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    const cards = page.locator('section[aria-label="Presentes disponíveis"] article');
    assert.equal(await cards.count(), 8);
    const imageAreas = await cards.evaluateAll(elements => elements.map(element => {
      const wrapper = element.firstElementChild;
      const bounds = wrapper.getBoundingClientRect();
      const image = wrapper.querySelector('img');
      return {
        width: bounds.width,
        height: bounds.height,
        objectFit: image ? getComputedStyle(image).objectFit : null,
      };
    }));
    const expectedRatio = width <= 640 ? 2 : 1 / 1.04;
    assert.ok(imageAreas.every(area => Math.abs(area.width / area.height - expectedRatio) < 0.02),
      `${width}px: unexpected image area ratio`);
    assert.ok(imageAreas.every(area => Math.abs(area.height - imageAreas[0].height) < 0.5),
      `${width}px: image and placeholder heights differ`);
    assert.equal(imageAreas[0].objectFit, 'cover');
    const card = name => cards.filter({ has: page.getByRole('heading', { name, exact: true }) });
    assert.equal(await card('Docinhos finos').getByRole('progressbar').getAttribute('aria-valuenow'), '0');
    assert.equal(await card('Docinhos finos').getByRole('progressbar').getAttribute('aria-valuemin'), '0');
    assert.equal(await card('Docinhos finos').getByRole('progressbar').getAttribute('aria-valuemax'), '100');
    assert.match(await card('Docinhos finos').innerText(), /0% alcançado/);
    assert.ok(!(await card('Docinhos finos').innerText()).includes('Faltam'));
    const partial = card('Nossa geladeira');
    assert.equal(await partial.getByRole('progressbar').getAttribute('aria-valuenow'), '35');
    const partialText = (await partial.innerText()).replace(/\u00a0/g, ' ');
    assert.match(partialText, /Meta: R\$ 3\.500/);
    assert.match(partialText, /R\$ 1\.225 arrecadados/);
    assert.match(partialText, /Faltam R\$ 2\.275/);
    const achieved = card('Nossa hospedagem em Gramado');
    assert.match(await achieved.innerText(), /Meta alcançada ❤️/);
    assert.equal(await achieved.getByRole('progressbar').getAttribute('aria-valuenow'), '100');
    assert.equal(await achieved.getByRole('button').count(), 0);
    const open = card('Uma ajudinha com os últimos boletos 😅');
    assert.match(await open.innerText(), /Contribua com o valor que desejar/);
    assert.equal(await open.getByRole('progressbar').count(), 0);
    assert.ok(!/Meta:|arrecadados|Faltam|%/.test(await open.innerText()));
    assert.equal(await card('Presente fixo de teste').getByRole('progressbar').count(), 0);
    assert.equal(await page.locator('section[aria-labelledby="presentes-insanos-title"]').getByRole('progressbar').count(), 0);
    assert.equal(await card('Limite inferior de teste').getByRole('progressbar').getAttribute('aria-valuenow'), '0');
    assert.equal(await card('Limite superior de teste').getByRole('progressbar').getAttribute('aria-valuenow'), '100');
    assert.ok(await card('Progresso ausente').getByRole('button').isDisabled());
    assert.equal(await card('Progresso ausente').getByRole('progressbar').count(), 0);
    // Check text glyph bounds, not just containers with overflow hidden.
    assert.ok(await cards.evaluateAll(elements => elements.every(element => {
      const bounds = element.getBoundingClientRect();
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        if (!walker.currentNode.textContent.trim() || walker.currentNode.parentElement.closest('h2')) continue;
        const range = document.createRange();
        range.selectNodeContents(walker.currentNode);
        if ([...range.getClientRects()].some(rect => rect.left < bounds.left || rect.right > bounds.right)) return false;
      }
      return true;
    })), `${width}px: card text overflow`);
    await partial.getByRole('button').click();
    assert.equal(await page.getByRole('dialog').getByRole('progressbar').getAttribute('aria-valuenow'), '35');
    await page.getByRole('button', { name: 'Fechar detalhes do presente' }).click();
    if (output) await page.locator('section[aria-label="Presentes disponíveis"]').screenshot({ path: `${output}/progress-${width}.png` });
    await page.getByRole('button', { name: 'Viagem', exact: true }).click();
    assert.ok(await page.getByRole('heading', { name: 'Nossa próxima aventura começa em Gramado.' }).isVisible());
    assert.equal(await cards.count(), 1);
    await page.getByRole('button', { name: 'Todos', exact: true }).click();
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
        centered: [...title.querySelectorAll('span')].every(span => getComputedStyle(span).textAlign === 'center'),
      };
    }));
    assert.equal(titles.length, 3);
    for (const [index, title] of titles.entries()) {
      assert.equal(title.text.replace(/\s+/g, ' ').trim(), medals[index].name.replace(' — ', ' ').toUpperCase());
      assert.ok(!title.text.includes('—'));
      assert.ok(title.contained, `${width}px: ${title.text} exceeds its card`);
      assert.equal(title.wrap, 'normal');
      assert.equal(title.lines, 2, `${width}px: expected exactly two lines`);
      assert.ok(title.centered, `${width}px: title lines must remain centered`);
    }
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (output) await page.locator('section[aria-labelledby="presentes-insanos-title"]').screenshot({ path: `${output}/insanos-${width}.png` });
    console.log(`${width}px: goal/open/fixed, completed goal, Gramado and overflow checks passed; medal titles ${titles.map(title => title.lines).join('/')} lines`);
  }
  progressAvailable = false;
  await page.reload();
  assert.equal(await page.getByRole('progressbar').count(), 0);
  assert.ok(await page.getByText('Progresso temporariamente indisponível').first().isVisible());
  assert.ok(requests.every(request => request.method === 'GET' && !request.path.includes('gift_contributions')));
  assert.ok(requests.some(request => request.path === '/rest/v1/rpc/get_gift_progress'));
} finally {
  await browser?.close();
  app.kill();
  await new Promise(resolve => api.close(resolve));
}
