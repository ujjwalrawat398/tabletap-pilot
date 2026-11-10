import { chromium } from 'playwright';
const code = process.argv[2];
const base = 'http://127.0.0.1:3000';
const browser = await chromium.launch();

const guest = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await guest.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message.slice(0, 200)));

// 1. first scan — no cookies at all: the guest lands on the code screen
await page.goto(`${base}/t/${code}`, { waitUntil: 'networkidle' });
const heading = await page.textContent('h1').catch(() => null);
console.log('home heading:', heading);
console.log('asks for a table code:', /table code/i.test(heading ?? ''));
const cookies = await guest.cookies();
console.log('cookies after scan:', cookies.map((c) => `${c.name}${c.httpOnly ? '(httpOnly)' : ''}`).join(', ') || 'none');
await page.screenshot({ path: '/tmp/shot-home.png', fullPage: true });

// 1b. the read-only preview: the menu opens, but adding needs the code
await page.goto(`${base}/t/${code}/menu`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
const previewText = await page.locator('body').innerText();
console.log('preview banner shown:', /Enter the table code to order/i.test(previewText));
await page.screenshot({ path: '/tmp/shot-preview.png', fullPage: false });

// 2. staff screen first: the code card must be on the waiter board
const staff = await browser.newContext({ viewport: { width: 430, height: 900 }, deviceScaleFactor: 2 });
const sp = await staff.newPage();
await sp.goto(`${base}/staff/login`, { waitUntil: 'networkidle' });
await sp.fill('#email', 'waiter@spiceroute.test');
await sp.fill('#password', 'Demo@1234');
await Promise.all([sp.waitForURL('**/waiter'), sp.click('button[type=submit]')]);
await sp.waitForTimeout(1500);
const boardWithCode = await sp.locator('body').innerText();
console.log('waiter sees the code card:', /Table codes/i.test(boardWithCode));
// only a LIVE card is a code a waiter would read out (dead cards stay on the board
// for five minutes so staff can see why guests are still waiting)
const codeChip = sp.locator('[data-code-state="live"][aria-label^="code "]').first();
const spoken = (await codeChip.getAttribute('aria-label')) ?? '';
const tableCode = spoken.replace('code ', '').replace(/\s+/g, '');
console.log('code read from the board:', tableCode.length, 'digits —', tableCode ? 'ok' : 'missing');
await sp.screenshot({ path: '/tmp/shot-waiter-code.png', fullPage: false });

// 3. the guest types it in
await page.goto(`${base}/t/${code}`, { waitUntil: 'networkidle' });
const boxes = page.locator('input[inputmode="numeric"]');
await boxes.first().click();
await boxes.first().fill(tableCode);
await page.waitForTimeout(2500);
const afterCode = await page.locator('body').innerText();
console.log('code accepted, table home shown:', /View Menu/i.test(afterCode) && !/Enter your table code/i.test(afterCode));
await page.screenshot({ path: '/tmp/shot-verified.png', fullPage: true });

// 4. menu — add an item, open cart
await page.goto(`${base}/t/${code}/menu`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const addButtons = page.getByRole('button', { name: /^Add$/ });
const addCount = await addButtons.count();
console.log('addable items:', addCount);
await addButtons.first().click();
await page.waitForTimeout(900);
const cartText = await page.locator('text=/Cart · \\d+/').first().textContent().catch(() => null);
console.log('cart bar:', cartText);
await page.screenshot({ path: '/tmp/shot-menu.png', fullPage: false });

// 3. open cart sheet and send the order
await page.locator('text=/Cart · \\d+/').first().click();
await page.waitForTimeout(500);
await page.screenshot({ path: '/tmp/shot-cart.png', fullPage: false });
await page.getByRole('button', { name: /Send order/ }).first().click();
await page.waitForTimeout(1500);
await page.goto(`${base}/t/${code}/status`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const statusText = await page.locator('body').innerText();
console.log('status page shows waiting:', /Waiting for waiter/i.test(statusText));
await page.screenshot({ path: '/tmp/shot-status.png', fullPage: true });

// 5. waiter confirms
await sp.reload({ waitUntil: 'networkidle' });
await sp.waitForTimeout(1200);
const boardText = await sp.locator('body').innerText();
console.log('waiter sees order:', /Orders waiting for you/i.test(boardText), '| table shown:', /Table \d/.test(boardText));
await sp.screenshot({ path: '/tmp/shot-waiter.png', fullPage: false });
const confirmBtn = sp.getByRole('button', { name: /Confirm/ }).first();
await confirmBtn.click();
await sp.waitForTimeout(1500);
const afterConfirm = await sp.locator('body').innerText();
console.log('pending cleared after confirm:', !/Orders waiting for you[\s\S]{0,80}pending/.test(afterConfirm));

// 5. kitchen marks it ready
const k = await browser.newContext({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 1.5 });
const kp = await k.newPage();
await kp.goto(`${base}/staff/login`, { waitUntil: 'networkidle' });
await kp.fill('#email', 'kitchen@spiceroute.test');
await kp.fill('#password', 'Demo@1234');
await Promise.all([kp.waitForURL('**/kitchen'), kp.click('button[type=submit]')]);
await kp.waitForTimeout(1200);
const kitchenText = await kp.locator('body').innerText();
console.log('kitchen sees confirmed order:', /Start preparing/i.test(kitchenText));
await kp.screenshot({ path: '/tmp/shot-kitchen.png', fullPage: false });
await kp.getByRole('button', { name: /Start preparing/i }).first().click();
await kp.waitForTimeout(1200);
await kp.getByRole('button', { name: /Mark ready/i }).first().click();
await kp.waitForTimeout(1200);

// 6. guest sees ready
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(3500);
const finalStatus = await page.locator('body').innerText();
console.log('guest sees Ready:', /Ready/.test(finalStatus));
await page.screenshot({ path: '/tmp/shot-status-ready.png', fullPage: true });

// 7. re-order without typing the code again (B10)
await page.goto(`${base}/t/${code}/menu`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
const again = page.getByRole('button', { name: /^Add$/ }).first();
await again.click();
await page.waitForTimeout(800);
await page.locator('text=/Cart · \\d+/').first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: /Send order/ }).first().click();
await page.waitForTimeout(1500);
const reorderOk = !/Enter your table code/i.test(await page.locator('body').innerText());
console.log('re-order without a code:', reorderOk);

// 8. a second phone at the same table joins with the same code
const guest2 = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page2 = await guest2.newPage();
await page2.goto(`${base}/t/${code}`, { waitUntil: 'networkidle' });
const boxes2 = page2.locator('input[inputmode="numeric"]');
await boxes2.first().click();
await boxes2.first().fill(tableCode);
await page2.waitForTimeout(2500);
const joined = !/Enter your table code/i.test(await page2.locator('body').innerText());
console.log('second phone joined with the same code:', joined);
await page2.screenshot({ path: '/tmp/shot-second-phone.png', fullPage: false });

// 9. waiter closes the table: codes die, both phones are sent back to the code screen
// (the table grid button is the way in — the sheet is where "Close session" lives)
await sp.reload({ waitUntil: 'networkidle' });
await sp.waitForTimeout(900);
const tableTile = sp.locator('button[aria-label^="Table "]').first();
await tableTile.scrollIntoViewIfNeeded();
await tableTile.click();
await sp.waitForTimeout(1500);
const closeBtn = sp.getByRole('button', { name: /^Close session$/i }).first();
await closeBtn.waitFor({ timeout: 10000 });
await closeBtn.click();
await sp.waitForTimeout(1800);
await sp.screenshot({ path: '/tmp/shot-waiter-closed.png', fullPage: false });
const waiterAfterClose = await sp.locator('body').innerText();
console.log('waiter sees the table free again:', /No active session/i.test(waiterAfterClose) || /FREE/i.test(waiterAfterClose));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(1200);
console.log('guest sent back to the code screen after close:', /Enter your table code/i.test(await page.locator('body').innerText()));

// 10. "Play with my table": a round must be answerable the moment the countdown ends
// (bug: the screen said "active" while every answer returned 409 "round has not
// started yet" — the stored round never left the lobby)
const getCode = async () => {
  await sp.reload({ waitUntil: 'networkidle' });
  await sp.waitForTimeout(1500);
  const chip = sp.locator('[data-code-state="live"][aria-label^="code "]').first();
  if (!(await chip.count())) return null;
  return ((await chip.getAttribute('aria-label')) ?? '').replace('code ', '').replace(/\s+/g, '');
};
// the table was closed in step 9: a fresh scan + code gets the guest back in
await page.goto(`${base}/t/${code}`, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);
let playCode = await getCode();
if (playCode) {
  const pb = page.locator('input[inputmode="numeric"]');
  await pb.first().click();
  await pb.first().fill(playCode);
  await page.waitForTimeout(2500);
}
await page.goto(`${base}/t/${code}/games`, { waitUntil: 'networkidle' });
await page.waitForTimeout(800);
await page.getByText(/Play with my table/i).click();
await page.waitForTimeout(3000);
const lobbyText = await page.locator('body').innerText();
console.log('table round lobby shown:', /Round starts in|Question 1/i.test(lobbyText));
// wait out the 20 s lobby, then answer the first question through the real UI
await page.waitForTimeout(22000);
const option = page.locator('[data-quiz-option]').first();
await option.waitFor({ timeout: 15000 }).catch(() => {});
const answerResponse = page
  .waitForResponse((r) => r.url().includes('/api/public/games/answer'), { timeout: 15000 })
  .catch(() => null);
await option.click({ timeout: 10000 }).catch(() => {});
const res = await answerResponse;
console.log(
  'answer accepted right after the countdown:',
  res ? res.status() === 200 : 'no answer request seen',
  res ? `(${res.status()})` : '',
);
await page.screenshot({ path: '/tmp/shot-games.png', fullPage: false });

// 11. "New party" from the WAITER board (bug: the button called the admin-only route)
await sp.reload({ waitUntil: 'networkidle' });
await sp.waitForTimeout(1800);
const partyBtn = sp.getByRole('button', { name: /New party/i }).first();
const hasParty = (await partyBtn.count()) > 0;
console.log('waiter sees the New party button (table open):', hasParty);
if (hasParty) {
  const partyResponse = sp
    .waitForResponse((r) => r.url().includes('new-party'), { timeout: 15000 })
    .catch(() => null);
  await partyBtn.click();
  await sp.waitForTimeout(2000);
  const pr = await partyResponse;
  console.log(
    'New party from the waiter board:',
    pr ? `${pr.status()} ${pr.url().split('/api')[1]}` : 'no call',
  );
}
await sp.screenshot({ path: '/tmp/shot-new-party.png', fullPage: false });

// 12. admin menu screen
const adm = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 1.5 });
const ap = await adm.newPage();
await ap.goto(`${base}/staff/login`, { waitUntil: 'networkidle' });
await ap.fill('#email', 'admin@spiceroute.test');
await ap.fill('#password', 'Demo@1234');
await Promise.all([ap.waitForURL('**/admin/**'), ap.click('button[type=submit]')]);
await ap.goto(`${base}/admin/overview`, { waitUntil: 'networkidle' });
await ap.waitForTimeout(1000);
await ap.screenshot({ path: '/tmp/shot-admin-overview.png', fullPage: false });
await ap.goto(`${base}/admin/menu`, { waitUntil: 'networkidle' });
await ap.waitForTimeout(800);
await ap.screenshot({ path: '/tmp/shot-admin-menu.png', fullPage: false });

await browser.close();
console.log('flow done');
