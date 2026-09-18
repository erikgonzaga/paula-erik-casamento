// Optional live UI regression. It reads the local /presentes page but intercepts
// every contribution POST, so no contribution can reach Supabase.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || 'playwright');
const baseUrl = (process.argv[3] || 'http://127.0.0.1:3000').replace(/\/$/, '');
const output = process.argv[4];
if (output) await mkdir(output, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage();
  page.on('pageerror', error => console.error('browser page error:', error.message));
  let contributionRequests = 0;
  const idempotencyKeys = [];
  await page.route('**/api/gift-contributions', async route => {
    contributionRequests += 1;
    const payload = route.request().postDataJSON();
    assert.match(payload.idempotency_key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    idempotencyKeys.push(payload.idempotency_key);
    await new Promise(resolve => setTimeout(resolve, 100));
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, payment_status: 'pending' }),
    });
  });

  for (const width of [375, 390, 430, 768, 1024, 1280, 1440]) {
    await page.setViewportSize({ width, height: 1100 });
    await page.goto(`${baseUrl}/presentes`, { waitUntil: 'domcontentloaded' });
    const normalCards = page.locator('section[aria-label="Presentes disponíveis"] article');
    await normalCards.first().waitFor();
    await page.waitForTimeout(800); // Allow client hydration under next dev.
    const contributionButton = normalCards.getByRole('button').filter({ hasText: /CONTRIBUIR/ }).first();
    await contributionButton.click();
    const dialog = page.getByRole('dialog');
    await page.waitForTimeout(300);
    assert.equal(await dialog.count(), 1,
      `${width}px: contribution button did not open a dialog: ${await contributionButton.evaluate(element => element.outerHTML)}`);
    const amountInput = dialog.getByLabel(/Outro valor/);
    assert.equal(await amountInput.count(), 1, `${width}px: amount field missing from ${await dialog.innerText()}`);
    await amountInput.fill('50,00');
    await dialog.getByLabel(/^Nome/).fill('Pessoa Teste');
    await dialog.getByLabel(/WhatsApp/).fill('(11) 99999-9999');
    if (output) await dialog.screenshot({ path: `${output}/form-${width}.png` });
    const before = contributionRequests;
    await dialog.locator('form').evaluate(form => { form.requestSubmit(); form.requestSubmit(); });
    await dialog.getByRole('status').waitFor();
    assert.equal(contributionRequests, before + 1, `${width}px: duplicate request was sent`);
    const bounds = await dialog.boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width, `${width}px: regular dialog overflow`);
    if (output) await dialog.screenshot({ path: `${output}/regular-${width}.png` });
    await dialog.getByRole('button', { name: 'Fechar detalhes do presente' }).click();

    await page.locator('#contribuir-bronze').click();
    const insaneDialog = page.getByRole('dialog', { name: /Medalha Bronze/i });
    assert.ok(await insaneDialog.getByLabel(/Nome de Colete/).isVisible());
    assert.equal(await insaneDialog.locator('input[name="amount"]').count(), 0);
    const insaneBounds = await insaneDialog.boundingBox();
    assert.ok(insaneBounds && insaneBounds.x >= 0 && insaneBounds.x + insaneBounds.width <= width,
      `${width}px: Insanos dialog overflow`);
    if (output) await insaneDialog.screenshot({ path: `${output}/insane-form-${width}.png` });
    await insaneDialog.getByRole('button', { name: 'Fechar contribuição' }).click();
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    console.log(`${width}px: contribution form, duplicate lock and fixed Insanos checks passed`);
  }
  assert.equal(new Set(idempotencyKeys).size, 7, 'Each intentional form submission must use a new idempotency key');
} finally {
  await browser.close();
}
