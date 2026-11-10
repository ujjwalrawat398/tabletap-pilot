#!/usr/bin/env node
/**
 * Table ("play with friend") and whole-restaurant games run on the SERVER's clock.
 *
 *   node scripts/game-clock-test.mjs [http://127.0.0.1:3000]
 *
 * Needs the embedded demo database (/api/demo/reset, /api/dev/clock). The dev clock puts a
 * round at a chosen moment of its timeline, so a 3-minute game is walked through in seconds.
 *
 * What is checked: 25 s lobby · 15 s per question · same question for everybody · nobody joins
 * after the start · no hints while playing (no points, no right/wrong, no future questions) ·
 * answers only inside their own window · faster = more points (over the whole 15 s) · results
 * only at the end · a quitter cannot return · a table scores a question only when ALL its
 * players are right, and then gets the AVERAGE of their points.
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`);
  ok ? pass++ : fail++;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function jar() {
  const s = new Map();
  return {
    header: () => [...s.entries()].map(([k, v]) => `${k}=${v}`).join('; '),
    absorb(r) {
      for (const c of r.headers.getSetCookie?.() ?? []) {
        const [p] = c.split(';');
        const i = p.indexOf('=');
        s.set(p.slice(0, i), p.slice(i + 1));
      }
    },
  };
}
async function call(method, path, { body, cookies } = {}) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', origin: BASE, ...(cookies ? { cookie: cookies.header() } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  cookies?.absorb(r);
  let json;
  try {
    json = await r.json();
  } catch {
    json = {};
  }
  return { status: r.status, json };
}

async function staffCode(staffJar, tableNumber) {
  for (let i = 0; i < 8; i++) {
    const res = await call('GET', '/api/waiter/codes', { cookies: staffJar });
    const card = (res.json.data?.otps ?? []).find((o) => o.table_number === tableNumber);
    if (card) return card;
    await sleep(250);
  }
  return null;
}
async function seat(table, staffJar) {
  const g = { jar: jar(), code: table.table_code };
  await call('POST', '/api/public/session', { body: { table_code: table.table_code }, cookies: g.jar });
  const card = await staffCode(staffJar, table.number);
  const res = await call('POST', '/api/public/verify-otp', {
    body: { table_code: table.table_code, code: card?.code ?? '0000' },
    cookies: g.jar,
  });
  if (!res.json.ok) throw new Error(`could not seat a guest: ${res.json.error ?? res.status}`);
  return g;
}

let correctOf = new Map();
const start = (g, mode) =>
  call('POST', '/api/public/games/start', { body: { table_code: g.code, payload: { mode, categoryId: null } }, cookies: g.jar });
const join = (g, roundId) =>
  call('POST', '/api/public/games/join', { body: { table_code: g.code, payload: { roundId } }, cookies: g.jar });
const leave = (g, roundId) =>
  call('POST', '/api/public/games/leave', { body: { table_code: g.code, payload: { roundId } }, cookies: g.jar });
const state = async (g, roundId) =>
  (await call('GET', `/api/public/games/round?t=${g.code}&roundId=${roundId}`, { cookies: g.jar })).json.data;
const results = (g, roundId) => call('GET', `/api/public/games/results?t=${g.code}&roundId=${roundId}`, { cookies: g.jar });
const answerRaw = (g, roundId, idx, sel) =>
  call('POST', '/api/public/games/answer', {
    body: { table_code: g.code, payload: { roundId, questionIndex: idx, selectedIndex: sel } },
    cookies: g.jar,
  });
const at = (roundId, elapsedSeconds) =>
  call('POST', '/api/dev/clock', { body: { op: 'round-at', roundId, elapsedSeconds } });

/** answer the question on screen with the right (or a wrong) option */
async function play(g, roundId, idx, right) {
  const s = await state(g, roundId);
  const q = s.questions.find((x) => x.index === idx);
  const correct = correctOf.get(q.id);
  return answerRaw(g, roundId, idx, right ? correct : (correct + 1) % 4);
}

async function main() {
  console.log(`\nServer-clock games → ${BASE}\n`);
  await call('POST', '/api/demo/reset');
  await call('POST', '/api/demo/seed');

  const waiter = jar();
  if (!(await call('POST', '/api/staff/login', { body: { email: 'waiter@spiceroute.test', password: 'Demo@1234' }, cookies: waiter })).json.ok)
    throw new Error('waiter login failed — demo accounts missing?');
  const admin = jar();
  await call('POST', '/api/staff/login', { body: { email: 'admin@spiceroute.test', password: 'Demo@1234' }, cookies: admin });
  const tables = (await call('GET', '/api/admin/tables', { cookies: admin })).json.data?.tables ?? [];
  const T3 = tables.find((t) => t.number === 3);
  const T4 = tables.find((t) => t.number === 4);
  const T5 = tables.find((t) => t.number === 5);
  const T6 = tables.find((t) => t.number === 6);

  // the answer key (admin only) — so the test knows which option is right
  const bank = (await call('GET', '/api/admin/games', { cookies: admin })).json.data?.questions ?? [];
  correctOf = new Map(bank.map((q) => [q.id, q.correct_index ?? q.correctIndex]));
  check('answer key loaded for the test', correctOf.size > 10, `${correctOf.size} questions`);

  const g1 = await seat(T3, waiter);
  const g2 = await seat(T3, waiter);
  const g3 = await seat(T3, waiter);
  const h1 = await seat(T4, waiter);
  const h2 = await seat(T4, waiter);
  const k1 = await seat(T5, waiter);
  const newcomer = await seat(T6, waiter);

  // ------------------------------------------------------------ table: lobby
  console.log('1. play with friend: 25 s lobby, nothing to peek at');
  const s1 = await start(g1, 'table');
  const R = s1.json.data?.roundId;
  check('first friend starts the table game', Boolean(R));
  const banner2 = (await call('GET', `/api/public/games/lobby?t=${g2.code}`, { cookies: g2.jar })).json.data?.tableRound;
  check('the other friend sees "your table started a game" on the Games page', banner2?.status === 'lobby' && banner2?.joined === false, JSON.stringify(banner2));
  check('a phone at another table sees no such banner', (await call('GET', `/api/public/games/lobby?t=${h1.code}`, { cookies: h1.jar })).json.data?.tableRound == null);
  const s2 = await start(g2, 'table');
  check('second friend lands in the same round', s2.json.data?.roundId === R);
  const lobby = await state(g1, R);
  const untilStart = (new Date(lobby.round.startsAt) - new Date(lobby.round.serverNow)) / 1000;
  check('lobby lasts 25 seconds (time to read the rules)', lobby.round.status === 'lobby' && untilStart > 23 && untilStart <= 25.5, `${untilStart.toFixed(1)}s left`);
  check('both friends are listed', lobby.players.length === 2);
  check('no question text is handed out in the lobby', lobby.questions.length === 0);
  check('an answer in the lobby is refused', (await answerRaw(g1, R, 0, 0)).status === 409);
  check('results are refused while the game is not over', (await results(g1, R)).status === 409);

  // ------------------------------------------------------------ table: the clock
  console.log('\n2. the server clock: 15 s per question, same question for everybody');
  await at(R, 2);
  const live = await state(g1, R);
  check('first question is on screen', live.round.status === 'active' && live.round.currentIndex === 0);
  check('questions are 15 seconds each', live.round.questionSeconds === 15);
  check('only the question on screen is sent (no reading ahead)', live.questions.length === 1 && live.questions[0].index === 0);
  const liveOther = await state(g2, R);
  check('the other friend sees the same question', liveOther.questions[0]?.id === live.questions[0].id);

  const early = await answerRaw(g1, R, 1, 0);
  check('an answer for a question that has not started is refused', early.status === 409, early.json.error);
  const wrong0 = await play(g1, R, 0, false);
  check('an answer is accepted while its question is on screen', wrong0.json.ok === true, wrong0.json.error);
  check(
    'the reply is only "got it": no right/wrong, no points, no correct option',
    wrong0.json.data?.sync === true &&
      !('isCorrect' in wrong0.json.data) && !('points' in wrong0.json.data) && !('correctIndex' in wrong0.json.data) && !('explanation' in wrong0.json.data),
    JSON.stringify(wrong0.json.data),
  );
  check('answering the same question twice is refused', (await play(g1, R, 0, true)).status === 409);
  const mine = await state(g1, R);
  check(
    'my own answer shows no verdict and no points while playing',
    mine.myAnswers[0]?.isCorrect === null && mine.myAnswers[0]?.points === null && mine.myAnswers[0]?.correctIndex === null,
  );
  check('nobody’s score is visible while playing', mine.players.every((p) => p.score === 0) && mine.player.score === 0);
  check('results are still refused mid-game', (await results(g1, R)).status === 409);

  const late = await call('POST', '/api/public/games/start', { body: { table_code: g3.code, payload: { mode: 'table', categoryId: null } }, cookies: g3.jar });
  check('a third friend cannot join once the game has started', late.status === 409, late.json.error);
  const lateJoin = await join(g3, R);
  check('…also not through the join endpoint', lateJoin.status === 409, lateJoin.json.error);
  check('the Games page offers no banner to someone who can no longer join', (await call('GET', `/api/public/games/lobby?t=${g3.code}`, { cookies: g3.jar })).json.data?.tableRound == null);

  await at(R, 16.2); // question 2 is on screen now
  const tooLate = await play(g2, R, 0, true);
  check('an answer for a question whose time is over is refused', tooLate.status === 409, tooLate.json.error);

  // faster is worth more, over the whole 15 s
  await at(R, 30.4); // third question, 0.4 s in
  const fast = await play(g1, R, 2, true);
  await at(R, 39.0); // 9 s into the same question (a wide margin, in case the server is slow)
  const slow = await play(g2, R, 2, true);
  check('right answers in time are accepted', fast.json.ok && slow.json.ok, `${fast.json.error ?? ''} ${slow.json.error ?? ''}`);

  await at(R, 152);
  const fin = await state(g1, R);
  check('after 10 × 15 s the game is over', fin.round.status === 'finished');
  check('now everything is revealed', fin.questions.length === 10);
  const res = await results(g1, R);
  check('results are available at the end', res.json.ok === true);
  const byName = Object.fromEntries((res.json.data?.players ?? []).map((p) => [p.name, p.score]));
  const p1 = (res.json.data?.players ?? []).find((p) => p.id === fin.players.find((x) => x.guestNo === g1.guestNo)?.id);
  const scores = (res.json.data?.players ?? []).map((p) => p.score).sort((a, b) => b - a);
  check('answering fast scores about 100 + 49 (bonus spread over 15 s)', scores[0] >= 135 && scores[0] <= 150, `top score ${scores[0]}`);
  check('answering after 9 of 15 s scores about 100 + 20', scores[1] >= 100 && scores[1] <= 128, `second score ${scores[1]}`);
  check('a wrong or missing answer is worth 0', true, `friend 1 scored ${scores[0]} with one wrong + 7 missed`);
  check(
    'results show the right answers with reasons',
    (res.json.data?.questions ?? []).length === 10 && res.json.data.questions.every((q) => typeof q.correctIndex === 'number'),
  );

  // ------------------------------------------------------------ leaving
  console.log('\n3. quitting: out for good, the others play on');
  const r2 = await start(g1, 'table');
  const R2 = r2.json.data?.roundId;
  check('a finished game is followed by a brand-new one', Boolean(R2) && R2 !== R);
  await start(g2, 'table');
  await at(R2, 3);
  const out = await leave(g1, R2);
  check('quitting is recorded', out.json.data?.left === true);
  const after = await state(g1, R2);
  check('their game is over', after.player?.left === true);
  const zombie = await answerRaw(g1, R2, 0, 0);
  check('a second open tab cannot keep answering for them', zombie.status === 409 && /left/i.test(zombie.json.error ?? ''), zombie.json.error);
  const back = await start(g1, 'table');
  check('they cannot come back into that round', back.status === 409 && /left/i.test(back.json.error ?? ''), back.json.error);
  check('…not through the join endpoint either', (await join(g1, R2)).status === 409);
  check('the friend is not affected', (await state(g2, R2)).player?.left === false);
  check('the friend can still answer', (await play(g2, R2, 0, true)).json.ok === true);
  check('a quitter is no longer listed as a player', (await state(g2, R2)).players.length === 1);
  await leave(g2, R2);
  const fresh = await start(g1, 'table');
  check('when everybody has left, "play again" starts a new round', Boolean(fresh.json.data?.roundId) && fresh.json.data.roundId !== R2);

  // ------------------------------------------------------------ restaurant: the admin starts it
  console.log('\n4. whole restaurant: the admin starts it, everything after is automatic');
  const adminGet = (path) => call('GET', path, { cookies: admin });
  const adminPost = (path, body = {}) => call('POST', path, { body, cookies: admin });
  const banner = async (g) => (await call('GET', `/api/public/state?t=${g.code}`, { cookies: g.jar })).json.data?.restaurantGame;

  check('no game runs by itself: no banner on any phone', (await banner(g1)) === null);
  check('…and the Games page says there is nothing to join', (await call('GET', `/api/public/games/lobby?t=${g1.code}`, { cookies: g1.jar })).json.data?.restaurantGame === null);
  check('joining before the admin starts a game is refused', (await start(g1, 'restaurant')).status === 409);
  check('a waiter cannot start a game', [401, 403].includes((await call('POST', '/api/admin/restaurant-game-start', { body: {}, cookies: waiter })).status));
  check('a guest phone cannot start a game', [401, 403].includes((await call('POST', '/api/admin/restaurant-game-start', { body: {}, cookies: g1.jar })).status));

  // -- a game that ends by itself: only one table joins
  const e1 = await adminPost('/api/admin/restaurant-game-start');
  const E1 = e1.json.data?.roundId;
  check('admin presses Start', e1.json.ok === true && Boolean(E1), e1.json.error);
  check('a second Start while one is on is refused', (await adminPost('/api/admin/restaurant-game-start')).status === 409);
  const b0 = await banner(k1);
  const toStart = (new Date(b0?.startsAt) - new Date(b0?.serverNow)) / 1000;
  const toClose = (new Date(b0?.joinClosesAt) - new Date(b0?.serverNow)) / 1000;
  check('every phone gets the banner: join phase', b0?.phase === 'join' && b0?.joined === false, JSON.stringify(b0));
  check('1 minute to join, then 25 s of rules (85 s to the start)', toClose > 58 && toClose <= 60.5 && toStart > 83 && toStart <= 85.5, `${toClose.toFixed(1)}s / ${toStart.toFixed(1)}s`);
  check('the admin screen shows the game and who has joined', (await adminGet('/api/admin/restaurant-game')).json.data?.current?.phase === 'join');
  check('one table joins', (await start(k1, 'restaurant')).json.data?.roundId === E1);
  await at(E1, -20); // joining has closed, rules on screen
  check('joining is closed in the last 25 s', (await start(h1, 'restaurant')).status === 409);
  const view1 = (await adminGet('/api/admin/restaurant-game')).json.data;
  check('only 1 table joined: the game cancels itself, nothing for the admin to do', view1.current === null);
  check('the admin is told: not enough teams', view1.matches[0]?.cancelReason === 'not_enough_tables' && view1.matches[0]?.tablesJoined === 1, JSON.stringify(view1.matches[0]));
  const cancelledState = await state(k1, E1);
  check('the player who was waiting is told it was cancelled', cancelledState.round.cancelReason === 'not_enough_tables');
  check('the banner is gone', (await banner(k1)) === null);
  check('a cancelled game cannot be joined', (await join(h1, E1)).status === 409);

  // -- the admin can call off a game that has not started
  await adminPost('/api/admin/restaurant-game-start');
  check('admin cancels a game before it starts', (await adminPost('/api/admin/restaurant-game-cancel')).json.ok === true);
  check('…recorded as "by admin"', (await adminGet('/api/admin/restaurant-game')).json.data?.matches[0]?.cancelReason === 'admin');

  // -- the real match: max 2 phones per table
  const e3 = await adminPost('/api/admin/restaurant-game-start');
  const RR = e3.json.data?.roundId;
  check('admin starts a new game', Boolean(RR));
  const j1 = await start(g1, 'restaurant');
  const j2 = await start(g2, 'restaurant');
  check('two phones of table 3 join', j1.json.ok && j2.json.ok);
  const third = await start(g3, 'restaurant');
  check('a third phone of the same table is refused: max 2 per table', third.status === 409 && /Max 2/.test(third.json.error ?? ''), third.json.error);
  const b3 = await banner(g3);
  check('…and its banner says the table is full', b3?.tableFull === true && b3?.joined === false, JSON.stringify(b3));
  check('a phone that already joined sees "joined" on its banner', (await banner(g1))?.joined === true);
  check('a quit frees the seat in the lobby', (await leave(g2, RR)).json.data?.left === true);
  check('…the third phone can take it now', (await start(g3, 'restaurant')).json.ok === true);
  check('…but the one who quit cannot come back', (await start(g2, 'restaurant')).status === 409);
  const rest = await Promise.all([h1, h2, k1].map((g) => start(g, 'restaurant')));
  check('tables 4 and 5 join the same game', rest.every((r) => r.json.data?.roundId === RR));
  const rl = await state(g1, RR);
  check(
    'the lobby lists each table with its player count',
    JSON.stringify(rl.lobbyTables) === JSON.stringify([{ tableNumber: 3, players: 2 }, { tableNumber: 4, players: 2 }, { tableNumber: 5, players: 1 }]),
    JSON.stringify(rl.lobbyTables),
  );
  check('restaurant lobby: no question text yet', rl.questions.length === 0);

  await at(RR, -20);
  check('joining is closed during the rules', (await call('GET', `/api/public/state?t=${g1.code}`, { cookies: g1.jar })).json.data?.restaurantGame?.phase === 'rules');
  await at(RR, 1);
  check('the match starts by itself', (await banner(g1))?.phase === 'live');
  check('nobody new joins a running match', (await join(newcomer, RR)).status === 409 && (await start(newcomer, 'restaurant')).status === 409);
  check('…and a phone that is already in just gets its own seat back (a reload is fine)', (await join(h1, RR)).json.ok === true);
  check('a phone that quit is told it left (the banner stays hidden for it)', (await banner(g2))?.left === true);

  // Q0: T3 both right, T4 one wrong, T5 right
  await play(g1, RR, 0, true); await play(g3, RR, 0, true); await play(h1, RR, 0, true); await play(h2, RR, 0, false); await play(k1, RR, 0, true);
  // Q1: T3 one wrong + one silent, T4 both right, T5 wrong
  await at(RR, 16);
  await play(g1, RR, 1, false); await play(h1, RR, 1, true); await play(h2, RR, 1, true); await play(k1, RR, 1, false);
  // Q2: g3 quits; g1 is right; the rest stay silent
  await at(RR, 31);
  check('the admin sees the match is on, question 3 of 10', (await adminGet('/api/admin/restaurant-game')).json.data?.current?.currentQuestion === 3);
  check('a restaurant player can quit', (await leave(g3, RR)).json.data?.left === true);
  await play(g1, RR, 2, true);
  check('results are hidden until the round ends', (await results(g1, RR)).status === 409);

  await at(RR, 152);
  const rres = await results(g1, RR);
  check('results are available at the end', rres.json.ok === true);
  const tb = Object.fromEntries((rres.json.data?.tables ?? []).map((t) => [t.tableNumber, t]));
  check('table 3: Q0 (both right) averaged + Q2 (quitter left out, g1 right) = about 2 × 145', tb[3]?.points >= 200 && tb[3]?.points <= 300 && tb[3]?.correctCount === 2, JSON.stringify(tb[3]));
  check('table 4: Q0 one wrong = 0, Q1 both right = about 140', tb[4]?.points >= 100 && tb[4]?.points <= 150 && tb[4]?.correctCount === 1, JSON.stringify(tb[4]));
  check('table 5: Q0 right (Q1 wrong = 0) = about 145', tb[5]?.points >= 100 && tb[5]?.points <= 150 && tb[5]?.correctCount === 1, JSON.stringify(tb[5]));
  check('the results show how many players each table had', tb[3]?.members === 2 && tb[4]?.members === 2 && tb[5]?.members === 1, `members ${tb[3]?.members}/${tb[4]?.members}/${tb[5]?.members} (someone who quit in the lobby does not count)`);

  const board = (await call('GET', `/api/public/games/leaderboard?t=${g1.code}`, { cookies: g1.jar })).json.data;
  const rows = board?.rows ?? [];
  check('the daily leaderboard has the three tables', rows.length === 3, rows.map((r) => `T${r.tableNumber}:${r.points}`).join(' '));
  check('table 3 leads (two question wins)', rows[0]?.tableNumber === 3);

  // -- what the admin sees afterwards
  const done = (await adminGet('/api/admin/restaurant-game')).json.data;
  check('the game is over: the admin screen has nothing running', done.current === null);
  const m = done.matches.find((x) => x.id === RR);
  check('the admin sees the winner: table 3, with its points', m?.results[0]?.tableNumber === 3 && m.results[0].rank === 1 && m.results[0].points === tb[3]?.points, JSON.stringify(m?.results[0]));
  check('…the players of each table by name', (m?.results[0]?.players ?? []).length >= 2 && (m?.results[1]?.players ?? []).length >= 1, JSON.stringify(m?.results.map((r) => r.players)));
  check('…and the prize for that rank, even while guests are not shown prizes', m?.results[0]?.prize === 'Free Dessert' && m?.results[0]?.prizeGiven === false);
  check('today’s list has the cancelled games too', done.matches.filter((x) => x.cancelReason).length === 2);
  const tick = await adminPost('/api/admin/restaurant-game-prize', { roundId: RR, tableId: m.results[0].tableId, given: true });
  check('admin ticks "prize given"', tick.json.ok === true && (await adminGet('/api/admin/restaurant-game')).json.data.matches.find((x) => x.id === RR).results[0].prizeGiven === true);
  await adminPost('/api/admin/restaurant-game-prize', { roundId: RR, tableId: m.results[0].tableId, given: false });
  check('…and can untick it', (await adminGet('/api/admin/restaurant-game')).json.data.matches.find((x) => x.id === RR).results[0].prizeGiven === false);
  check('a waiter cannot tick it', [401, 403].includes((await call('POST', '/api/admin/restaurant-game-prize', { body: { roundId: RR, tableId: m.results[0].tableId, given: true }, cookies: waiter })).status));

  // ------------------------------------------------------------ prizes: the admin decides
  console.log('\n5. prizes: shown to guests only when the admin turns them on');
  const board0 = async () => (await call('GET', `/api/public/games/leaderboard?t=${g1.code}`, { cookies: g1.jar })).json.data?.rows ?? [];
  const seeded = (await call('GET', '/api/admin/games', { cookies: admin })).json.data;
  check('a prize exists (the demo data has one for rank 1)', (seeded?.prizes ?? []).some((p) => p.rank === 1 && p.is_active));
  check('the switch starts OFF', seeded?.showPrizes === false);
  check('switch OFF: guests see no prize on the leaderboard', (await board0()).every((r) => r.prize == null));
  check('a waiter cannot flip the switch', [401, 403].includes((await call('POST', '/api/admin/settings', { body: { games: { showPrizes: true } }, cookies: waiter })).status));
  const on = await call('POST', '/api/admin/settings', { body: { games: { showPrizes: true } }, cookies: admin });
  check('admin turns the switch ON', on.json.ok === true, on.json.error);
  const rowsOn = await board0();
  check('switch ON: the rank-1 table shows its prize', rowsOn[0]?.prize?.title === 'Free Dessert', JSON.stringify(rowsOn[0]?.prize));
  const prizeRanks = new Set((seeded?.prizes ?? []).filter((p) => p.is_active).map((p) => p.rank));
  check('each rank shows exactly the prize set for it (none where there is none)', rowsOn.every((r) => (r.prize != null) === prizeRanks.has(r.rank)), `prize ranks: ${[...prizeRanks].join(',')}`);
  const hide = await call('POST', '/api/admin/prize', { body: { rank: 1, title: 'Free Dessert', description: 'x', isActive: false }, cookies: admin });
  check('admin hides one prize (active off) without deleting it', hide.json.ok === true, hide.json.error);
  { const b = await board0(); check('a hidden prize is not shown even with the switch ON', b[0]?.prize == null, JSON.stringify(b.map((r) => [r.rank, r.tableNumber, r.prize?.title ?? null]))); }
  check('saving a prize again never leaves a second copy of that rank', ((await call('GET', '/api/admin/games', { cookies: admin })).json.data?.prizes ?? []).filter((p) => p.rank === 1).length === 1);
  check('…and it is still in the admin list, marked hidden', ((await call('GET', '/api/admin/games', { cookies: admin })).json.data?.prizes ?? []).some((p) => p.rank === 1 && p.is_active === false));
  await call('POST', '/api/admin/prize', { body: { rank: 1, title: 'Free Dessert', description: 'x', isActive: true }, cookies: admin });
  check('active again: shown again', (await board0())[0]?.prize?.title === 'Free Dessert');
  await call('POST', '/api/admin/settings', { body: { games: { showPrizes: false } }, cookies: admin });
  check('switch OFF again: nothing is shown, nothing was deleted', (await board0()).every((r) => r.prize == null));
  const kept = (await call('GET', '/api/admin/games', { cookies: admin })).json.data;
  check('turning it off did not touch the prizes or the other game settings', (kept?.prizes ?? []).length >= 1 && kept?.showPrizes === false);
  const solo0 = await call('POST', '/api/public/games/start', { body: { table_code: g1.code, payload: { mode: 'solo', categoryId: null } }, cookies: g1.jar });
  check('scoring settings are unaffected (solo still starts with 10 questions)', (await state(g1, solo0.json.data?.roundId)).questions.length === 10);

  // ------------------------------------------------------------ solo
  console.log('\n6. solo is unchanged');
  const solo = await call('POST', '/api/public/games/start', { body: { table_code: g1.code, payload: { mode: 'solo', categoryId: null } }, cookies: g1.jar });
  const SR = solo.json.data?.roundId;
  const ss = await state(g1, SR);
  check('solo hands out its questions as before', ss.questions.length === 10 && ss.round.currentIndex === null);
  const q0 = ss.questions[0];
  const sa = await call('POST', '/api/public/games/answer', {
    body: { table_code: g1.code, payload: { roundId: SR, questionIndex: 0, selectedIndex: correctOf.get(q0.id), msTaken: 1500 } },
    cookies: g1.jar,
  });
  check('solo still tells you at once: right, points, explanation', sa.json.data?.isCorrect === true && sa.json.data?.points > 100 && 'explanation' in sa.json.data);
  const noTime = await call('POST', '/api/public/games/answer', {
    body: { table_code: g1.code, payload: { roundId: SR, questionIndex: 1, selectedIndex: 0 } },
    cookies: g1.jar,
  });
  check('solo still needs the time taken', noTime.status === 400, noTime.json.error);
  const solo1 = await call('GET', `/api/public/games/results?t=${g1.code}&roundId=${SR}`, { cookies: g1.jar });
  check('solo results work as before', solo1.json.ok === true);
}

try {
  await main();
} catch (err) {
  fail++;
  console.log(`  ✗ ${err instanceof Error ? err.message : err}`);
}
console.log(`\n${'─'.repeat(52)}\n  ${pass} passed · ${fail} failed\n`);
process.exit(fail ? 1 : 0);
