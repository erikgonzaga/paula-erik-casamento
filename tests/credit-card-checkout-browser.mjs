// Optional browser QA. Catalogue, SDK, challenge and HTTP are local fakes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const cwd = fileURLToPath(new URL('../', import.meta.url));
const output = process.argv[3] || `${cwd}/.screenshots/card-checkout-stage3`;
await mkdir(output, { recursive: true });
const gifts = [
  { id: '00000000-0000-4000-8000-000000000001', name: 'Uma ajudinha com os últimos boletos 😅', slug: 'ajudinha-ultimos-boletos',
    category: 'party', gift_type: 'regular', funding_mode: 'open', target_amount: null, image_url: null,
    description: 'Catálogo fictício para validação local.', display_order: 1, allow_multiple: true },
  { id: '00000000-0000-4000-8000-000000000002', name: 'Presente Insano — Moeda de Bronze', slug: 'moeda-bronze',
    category: 'insanos', gift_type: 'insanos', funding_mode: 'fixed', target_amount: 75, image_url: '/images/presentes/moeda-bronze-final.png',
    description: 'Catálogo fictício para validação local.', display_order: 36, allow_multiple: true },
];
const fixture = createServer((request, response) => {
  const path = new URL(request.url, 'http://localhost').pathname;
  response.writeHead(['/rest/v1/gifts', '/rest/v1/rpc/get_gift_progress'].includes(path) ? 200 : 400, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(path === '/rest/v1/gifts' ? gifts : []));
});
await new Promise(resolve => fixture.listen(0, '127.0.0.1', resolve));
const fixtureUrl = `http://127.0.0.1:${fixture.address().port}`;
const baseUrl = 'http://127.0.0.1:3138';
const next = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--webpack', '--hostname', '127.0.0.1', '--port', '3138'], {
  cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, APP_ORIGIN: baseUrl, NEXT_PUBLIC_SUPABASE_URL: fixtureUrl, SUPABASE_URL: fixtureUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'MOCK_ANON', SUPABASE_SERVICE_ROLE_KEY: 'MOCK_SERVICE',
    MERCADO_PAGO_ACCESS_TOKEN: 'MOCK_NOT_USED', MERCADO_PAGO_WEBHOOK_SECRET: 'MOCK_NOT_USED',
    PAYMENTS_ENVIRONMENT: 'test', ENABLE_CREDIT_CARD_CHECKOUT: 'true', NEXT_PUBLIC_MERCADO_PAGO_PUBLIC_KEY: 'MOCK_PUBLIC_KEY', NEXT_TELEMETRY_DISABLED: '1' },
});
next.stdout.resume(); next.stderr.resume(); // Never print configuration or response bodies.
let exited = false; next.once('exit', () => { exited = true; });
let browser;
try {
  let ready = false;
  for (let index = 0; index < 90; index++) {
    if (exited) throw new Error('Local fixture server exited before QA');
    try { ready = (await fetch(`${baseUrl}/presentes`, { signal: AbortSignal.timeout(2000) })).ok; } catch { /* Starting. */ }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  assert.ok(ready, 'Local isolated fixture did not start');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', error => errors.push(error.name));
  let posts = 0, queries = 0, sdkRequests = 0, frameResponses = 0, challengeComplete = false;
  await page.addInitScript(() => { window.__brickQA = { created: 0, unmounted: 0 }; });
  await page.context().route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin === baseUrl && url.pathname === '/api/gift-contributions') {
      posts++; const body = route.request().postDataJSON();
      assert.equal(body.payment_method, 'credit_card'); assert.equal(body.installments, 12); assert.equal(body.card_token, 'MOCK_TEMP_TOKEN');
      for (const key of ['card_number', 'cvv', 'expiration_date']) assert.ok(!Object.hasOwn(body, key));
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ payment_status: 'pending', payment: {
        status: 'action_required', expires_at: '', qr_code: null, qr_code_base64: null, ticket_url: null, challenge: { url: 'https://issuer.example/challenge' },
      } }) });
    }
    if (url.origin === baseUrl && url.pathname === '/api/gift-contributions/status') {
      queries++;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ payment_status: challengeComplete ? 'confirmed' : 'pending',
        payment: { status: challengeComplete ? 'confirmed' : 'action_required', expires_at: '', qr_code: null, qr_code_base64: null, ticket_url: null,
          ...(challengeComplete ? {} : { challenge: { url: 'https://issuer.example/challenge' } }) } }) });
    }
    if (url.hostname === 'sdk.mercadopago.com') {
      sdkRequests++;
      return route.fulfill({ status: 200, contentType: 'application/javascript', body: `
      window.MercadoPago = class { bricks() { return { create: async (type, id, settings) => {
        window.__brickQA.created++;
        const host = document.getElementById(id);
        host.dataset.mountWidth = String(host.getBoundingClientRect().width);
        host.innerHTML = '<style>.mockControl{box-sizing:border-box;font:16px Arial}</style><form data-mock-brick style="display:grid;grid-template-columns:minmax(0,1fr);gap:16px;width:100%;line-height:1.5"><p>FORMULÁRIO SDK SIMULADO</p><label style="display:grid;gap:8px"><span data-mock-label>Dados do cartão no SDK</span><input class="mockControl" style="width:100%;padding:12px;border:1px solid #c7bda8;border-radius:6px" placeholder="Campos seguros do provedor" disabled /></label><label style="display:grid;gap:8px">Validade<input class="mockControl" placeholder="MM/AA" disabled style="width:100%" /></label><label style="display:grid;gap:8px">CVV<input class="mockControl" disabled style="width:100%" /></label><label style="display:grid;gap:8px">Nome do titular<input class="mockControl" disabled style="width:100%" /></label><button type="button" data-expand style="padding:12px">MOSTRAR PARCELAS E DOCUMENTO</button><div data-extra hidden></div><button style="padding:12px" type="submit">PAGAR (SDK SIMULADO)</button></form>';
        host.querySelector('[data-expand]').onclick = () => { host.querySelector('[data-extra]').innerHTML = "<h2 data-first-dynamic style=\\"font:16px Arial;margin:0\\">Op\\u00e7\\u00f5es de parcelamento</h2><label style=\\"display:grid;gap:8px\\"><span data-mock-label>Parcelamento dispon\\u00edvel</span><select class='mockControl' style=\\"width:100%;min-width:0;padding:12px;border:1px solid #c7bda8;border-radius:6px;font:inherit\\"><option>10x R$ 24,13</option></select></label><label style=\\"display:grid;gap:8px;margin-top:16px\\"><h2 data-mock-label style=\\"font:16px Arial;margin:0\\">Documento do titular do cart\\u00e3o</h2><input class='mockControl' style=\\"width:100%;padding:12px;border:1px solid #c7bda8;border-radius:6px\\" placeholder=\\"Documento fict\\u00edcio\\" /></label><p role=\\"alert\\" style=\\"margin-top:16px\\">Confira o documento do titular e escolha uma op\\u00e7\\u00e3o de parcelamento dispon\\u00edvel antes de continuar com este pagamento simulado.</p>"; host.querySelector('[data-extra]').hidden = false; };
        host.querySelector('form').onsubmit = async event => { event.preventDefault(); await settings.callbacks.onSubmit({ token: 'MOCK_TEMP_TOKEN', payment_method_id: 'master', installments: 12 }, { paymentTypeId: 'credit_card' }); };
        settings.callbacks.onReady();
        return { unmount: async () => { window.__brickQA.unmounted++; host.innerHTML = ''; } };
      } }; } };
      ` });
    }
    if (url.origin === 'https://issuer.example') {
      frameResponses++;
      return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body:
        '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"></head><body style="font:18px Georgia;color:#4e402f;background:#f8f5ec;padding:24px"><p>Desafio 3DS simulado</p><button onclick="parent.postMessage({status:\'COMPLETE\'},\'*\')">Concluir desafio fictício</button></body></html>' });
    }
    if (url.origin === baseUrl) return route.continue();
    return route.abort(); // Blocks real provider, tokenization and telemetry.
  });
  for (const width of [390, 768, 1024, 1440]) {
    challengeComplete = false;
    const sdkBefore = sdkRequests;
    await page.setViewportSize({ width, height: 1100 });
    await page.goto(`${baseUrl}/presentes`, { waitUntil: 'networkidle' });
    await page.locator('section[aria-label="Presentes disponíveis"] article').getByRole('button', { name: 'CONTRIBUIR', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel(/Outro valor/).fill('50,00'); await dialog.getByLabel(/^Nome/).fill('Pessoa Fictícia');
    await dialog.getByLabel(/WhatsApp/).fill('11999999999'); await dialog.getByLabel(/E-mail/).fill('fixture@example.invalid');
    assert.equal(sdkRequests, sdkBefore, 'Pix must not load MercadoPago.js');
    await dialog.screenshot({ path: `${output}/methods-${width}.png` });
    await dialog.getByRole('button', { name: 'Cartão de crédito', exact: true }).click(); await dialog.getByRole('button', { name: 'CONTINUAR', exact: true }).click();
    await dialog.getByRole('button', { name: 'PAGAR (SDK SIMULADO)' }).waitFor();
    assert.equal(sdkRequests, sdkBefore + 1);
    const brick = dialog.locator('section[aria-label="Pagamento com cartão de crédito"]');
    const beforeHeight = (await brick.boundingBox()).height;
    const initialStyles = await brick.evaluate(element => { const h = document.createElement('h2'); element.querySelector('[data-mp-brick-host]').append(h); const c = getComputedStyle(h); const result = { gridArea: c.gridArea, overflowWrap: c.overflowWrap, boxSizing: c.boxSizing }; h.remove(); return result; });
    assert.equal(initialStyles.gridArea, 'auto'); assert.equal(initialStyles.overflowWrap, 'normal'); assert.equal(initialStyles.boxSizing, 'content-box');
    assert.equal(await brick.locator('input').first().evaluate(element => getComputedStyle(element).boxSizing), 'border-box', 'SDK class must override neutral boundary');
    const beforeLabel = await brick.locator('[data-mock-label]').first().evaluate(element => {
      const style = getComputedStyle(element);
      return { tag: element.tagName, width: element.getBoundingClientRect().width,
        fontSize: style.fontSize, lineHeight: style.lineHeight, boxSizing: style.boxSizing,
        overflowWrap: style.overflowWrap, wordBreak: style.wordBreak, whiteSpace: style.whiteSpace };
    });
    await dialog.getByRole('button', { name: 'MOSTRAR PARCELAS E DOCUMENTO' }).click();
    const afterLabel = await brick.locator('[data-mock-label]').first().evaluate(element => {
      const style = getComputedStyle(element);
      return { tag: element.tagName, width: element.getBoundingClientRect().width,
        fontSize: style.fontSize, lineHeight: style.lineHeight, boxSizing: style.boxSizing,
        overflowWrap: style.overflowWrap, wordBreak: style.wordBreak, whiteSpace: style.whiteSpace };
    });
    assert.deepEqual(afterLabel, beforeLabel, 'Existing label geometry/styles must survive the dynamic insertion');
    const insertedAncestors = await brick.locator('[data-first-dynamic]').evaluate(element => {
      const results = [];
      for (let node = element; node && results.length < 5; node = node.parentElement) {
        const style = getComputedStyle(node);
        results.push({ tag: node.tagName, display: style.display, width: style.width,
          minWidth: style.minWidth, maxWidth: style.maxWidth, gridTemplateColumns: style.gridTemplateColumns,
          gridArea: style.gridArea, flex: style.flex, position: style.position,
          whiteSpace: style.whiteSpace, wordBreak: style.wordBreak, overflowWrap: style.overflowWrap,
          fontSize: style.fontSize, lineHeight: style.lineHeight, boxSizing: style.boxSizing });
      }
      return results;
    });
    assert.equal(insertedAncestors[0].gridArea, 'auto');
    const collision = await brick.locator('h2[data-mock-label]').evaluate(heading => {
      const before = { columns: getComputedStyle(heading.parentElement).gridTemplateColumns,
        gridArea: getComputedStyle(heading).gridArea };
      const oldRule = document.createElement('style');
      // Reintroduce the historical selector on this fixture only, never production.
      oldRule.textContent = '[role="dialog"] h2 { grid-area:title; overflow-wrap:anywhere; }';
      document.head.append(oldRule);
      const leaked = { columns: getComputedStyle(heading.parentElement).gridTemplateColumns,
        gridArea: getComputedStyle(heading).gridArea };
      oldRule.remove();
      return { before, leaked };
    });
    assert.equal(collision.leaked.gridArea, 'title');
    assert.notEqual(collision.leaked.columns, collision.before.columns, 'Historical heading rule creates implicit grid tracks');
    console.log(JSON.stringify({ fixtureViewport: width, beforeLabel, afterLabel, insertedAncestors }));
    const geometry = await brick.evaluate(element => ({
      width: element.getBoundingClientRect().width,
      mountWidth: Number(element.querySelector('[data-mount-width]').dataset.mountWidth),
      height: element.getBoundingClientRect().height,
      overflow: element.scrollWidth > element.clientWidth,
      labels: [...element.querySelectorAll('[data-mock-label]')].map(label => ({ width: label.getBoundingClientRect().width, height: label.getBoundingClientRect().height })),
    }));
    const minimum = width === 390 ? 300 : width === 768 ? 600 : width === 1024 ? 800 : 600;
    assert.ok(geometry.width >= minimum, `${width}px: Brick width ${geometry.width}`);
    assert.ok(geometry.mountWidth >= minimum, `${width}px: narrow initial mount`);
    assert.ok(geometry.height > beforeHeight, 'Dynamic fields must grow the container');
    assert.equal(geometry.overflow, false);
    assert.equal(await brick.locator('h2[data-mock-label]').evaluate(element => getComputedStyle(element).gridArea), 'auto');
    assert.ok(geometry.labels.every(label => label.width >= 280 && label.height < 60), 'No vertically squeezed labels');
    assert.ok(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), 'No modal horizontal overflow');
    await dialog.getByRole('button', { name: 'PAGAR (SDK SIMULADO)' }).scrollIntoViewIfNeeded();
    const payBox = await dialog.getByRole('button', { name: 'PAGAR (SDK SIMULADO)' }).boundingBox();
    assert.ok(payBox.y >= 0 && payBox.y + payBox.height <= 1100, 'Pay button reachable through vertical scroll');
    await dialog.screenshot({ path: `${output}/brick-mock-${width}.png` });
    assert.equal((await page.evaluate(() => window.__brickQA)).created, 1);
    if (width === 1440) {
      await page.setViewportSize({ width: 768, height: 1100 });
      assert.ok((await brick.boundingBox()).width >= 600);
      assert.equal((await page.evaluate(() => window.__brickQA)).created, 1, 'Resizing must not duplicate or reset the Brick');
      await page.setViewportSize({ width, height: 1100 });
    }
    await dialog.getByRole('button', { name: 'VOLTAR AO PIX' }).click();
    assert.equal((await page.evaluate(() => window.__brickQA)).unmounted, 1);
    await dialog.getByRole('button', { name: 'Cartão de crédito', exact: true }).click(); await dialog.getByRole('button', { name: 'CONTINUAR', exact: true }).click();
    await dialog.getByRole('button', { name: 'PAGAR (SDK SIMULADO)' }).waitFor();
    assert.equal((await page.evaluate(() => window.__brickQA)).created, 2);
    const before = posts;
    await dialog.getByRole('button', { name: 'PAGAR (SDK SIMULADO)' }).click(); await dialog.locator('iframe').waitFor();
    await dialog.locator('iframe').scrollIntoViewIfNeeded();
    try {
      await page.frameLocator('iframe[title="Verificação segura do cartão"]').getByRole('button', { name: 'Concluir desafio fictício' }).waitFor({ timeout: 10000 });
    } catch {
      console.log('Fake frame diagnostic:', { fulfilled: frameResponses, frames: await Promise.all(page.frames().map(async frame => ({
        isMain: frame === page.mainFrame(), url: frame.url(), buttons: await frame.locator('button').count(),
        characters: await frame.locator('body').evaluate(body => body.textContent.length).catch(() => -1),
      }))) });
      throw new Error('Isolated fake challenge did not load');
    }
    assert.equal(posts, before + 1); assert.ok(!(await dialog.innerText()).includes('aprovado e confirmado'));
    assert.ok(!(await dialog.locator('iframe').getAttribute('sandbox')).includes('top-navigation'));
    await dialog.screenshot({ path: `${output}/challenge-${width}.png` });
    challengeComplete = true; const checked = queries;
    await page.frameLocator('iframe[title="Verificação segura do cartão"]').getByRole('button', { name: 'Concluir desafio fictício' }).click();
    await dialog.getByText('Pagamento aprovado e confirmado.', { exact: true }).waitFor(); assert.ok(queries > checked);
    await dialog.getByRole('button', { name: 'Fechar detalhes do presente' }).click();
    await page.locator('#contribuir-bronze').click();
    assert.equal(await page.getByRole('dialog').locator('input[name="amount"]').count(), 0);
    assert.ok(await page.getByRole('dialog').getByLabel(/Nome de Colete/).isVisible());
    await page.getByRole('dialog').getByRole('button', { name: 'Fechar contribuição' }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: horizontal overflow`);
    assert.deepEqual(errors, []);
    console.log(`${width}px: fake SDK, method switch, cleanup, pending, 3DS/status and fixed gift passed`);
  }
} finally {
  await browser?.close();
  const stopped = new Promise(resolve => next.once('exit', resolve));
  if (!exited) { next.kill(); await stopped; }
  await new Promise(resolve => fixture.close(resolve));
}
