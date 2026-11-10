import 'server-only';
import { db, transaction } from '@/server/db';
import type { TableSession } from '@/server/session';
import type { RestaurantGameInfo } from '@/types';
import {
  QUIZ_ANSWER_RATE_LIMIT,
  RESTAURANT_JOIN_WINDOW_SECONDS,
  RESTAURANT_MAX_PLAYERS_PER_TABLE,
  RESTAURANT_MIN_TABLES,
  SYNC_INSTRUCTION_SECONDS,
  SYNC_QUESTION_SECONDS,
} from '@/lib/constants';
import { rateLimit } from '@/server/auth';
import { sanitizeText } from '@/lib/sanitize';

export class GameError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/** The database clock in ms. Round windows are judged against it so every check agrees. */
async function dbNowMs(): Promise<number> {
  const row = await db.one<{ ms: string | number }>(`select (extract(epoch from now()) * 1000)::bigint as ms`);
  return Number(row?.ms ?? Date.now());
}

const SYNC_QUESTION_MS = SYNC_QUESTION_SECONDS * 1000;

type GameSettings = {
  roundsPerRound: number;
  restaurantRoundIntervalMinutes: number;
  speedBonusMax: number;
  speedBonusWindowMs: number;
  pointsCorrect: number;
  pointsMode: 'sum' | 'average';
  /** Admin's master switch: guests see leaderboard prizes only when this is on. */
  showPrizes: boolean;
};

const DEFAULT_GAME_SETTINGS: GameSettings = {
  roundsPerRound: 10,
  restaurantRoundIntervalMinutes: 5,
  speedBonusMax: 50,
  speedBonusWindowMs: 10000,
  pointsCorrect: 100,
  pointsMode: 'sum',
  showPrizes: false,
};

export async function getGameSettings(restaurantId: string): Promise<GameSettings> {
  const row = await db.one<{ value: any }>(
    `select value from settings where restaurant_id = $1 and key = 'games'`,
    [restaurantId],
  );
  const v = row?.value ?? {};
  return {
    roundsPerRound: v.roundsPerRound ?? v.rounds_per_round ?? DEFAULT_GAME_SETTINGS.roundsPerRound,
    restaurantRoundIntervalMinutes:
      v.restaurantRoundIntervalMinutes ?? DEFAULT_GAME_SETTINGS.restaurantRoundIntervalMinutes,
    speedBonusMax: v.speedBonusMax ?? DEFAULT_GAME_SETTINGS.speedBonusMax,
    speedBonusWindowMs: v.speedBonusWindowMs ?? DEFAULT_GAME_SETTINGS.speedBonusWindowMs,
    pointsCorrect: v.pointsCorrect ?? DEFAULT_GAME_SETTINGS.pointsCorrect,
    pointsMode: v.pointsMode === 'average' ? 'average' : 'sum',
    showPrizes: v.showPrizes === true,
  };
}

// ---------------------------------------------------------------- catalogue
export async function getQuizCategories(restaurantId: string) {
  const rows = await db.query<any>(
    `select c.id, c.name, c.slug, c.emoji,
            (select count(*)::int from quiz_questions q
              where q.category_id = c.id and q.is_active) as question_count
       from quiz_categories c
      where c.restaurant_id = $1 and c.is_active
      order by c.sort_order, c.name`,
    [restaurantId],
  );
  return rows;
}

/**
 * Picks question ids for a new round, avoiding questions this session already
 * answered (spec §12). Falls back to the full pool once exhausted.
 */
async function pickQuestions(input: {
  restaurantId: string;
  categoryId?: string | null;
  count: number;
  sessionId?: string | null;
}) {
  const seen = input.sessionId
    ? await db.query<{ question_id: string }>(
        `select distinct ga.question_id
           from game_answers ga
           join game_players gp on gp.id = ga.player_id
          where gp.session_id = $1`,
        [input.sessionId],
      )
    : [];
  const seenIds = seen.map((s) => s.question_id);

  const rows = await db.query<{ id: string }>(
    `select id from quiz_questions
      where restaurant_id = $1
        and is_active
        and ($2::uuid is null or category_id = $2::uuid)
        and ($3::uuid[] is null or not (id = any($3::uuid[])))
      order by random()
      limit $4`,
    [input.restaurantId, input.categoryId ?? null, seenIds.length ? seenIds : null, input.count],
  );

  if (rows.length >= Math.min(input.count, 5)) return rows.map((r) => r.id);

  // pool exhausted — reuse unseen-first ordering over the whole bank
  const fallback = await db.query<{ id: string }>(
    `select id from quiz_questions
      where restaurant_id = $1 and is_active
        and ($2::uuid is null or category_id = $2::uuid)
      order by (id = any($3::uuid[])), random()
      limit $4`,
    [input.restaurantId, input.categoryId ?? null, seenIds.length ? seenIds : [], input.count],
  );
  return fallback.map((r) => r.id);
}

async function createRound(input: {
  restaurantId: string;
  mode: 'solo' | 'table' | 'restaurant';
  sessionId?: string | null;
  categoryId?: string | null;
  startsAt: Date;
  durationMinutes: number;
}) {
  const settings = await getGameSettings(input.restaurantId);
  const questionIds = await pickQuestions({
    restaurantId: input.restaurantId,
    categoryId: input.categoryId,
    count: settings.roundsPerRound,
    sessionId: input.sessionId,
  });
  if (questionIds.length === 0) throw new GameError('No quiz questions available yet.', 409);

  const round = await db.one<{ id: string }>(
    `insert into game_rounds (restaurant_id, mode, status, session_id, category_id, question_ids,
                              question_count, starts_at, ends_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning id`,
    [
      input.restaurantId,
      input.mode,
      'active',
      input.sessionId ?? null,
      input.categoryId ?? null,
      questionIds,
      questionIds.length,
      input.startsAt.toISOString(),
      new Date(input.startsAt.getTime() + input.durationMinutes * 60_000).toISOString(),
    ],
  );
  return { roundId: round!.id, questionIds };
}

async function addPlayer(input: {
  roundId: string;
  restaurantId: string;
  sessionId: string;
  tableId: string;
  guestNo: number;
  displayName?: string;
}) {
  const name = sanitizeText(input.displayName ?? '', 24) || `Guest ${input.guestNo}`;
  const row = await db.one<{ id: string }>(
    `insert into game_players (restaurant_id, round_id, session_id, table_id, guest_no, display_name)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (round_id, session_id, guest_no) do update set display_name = excluded.display_name
     returning id`,
    [input.restaurantId, input.roundId, input.sessionId, input.tableId, input.guestNo, name],
  );
  return row!.id;
}

// ---------------------------------------------------------------- solo
export async function startSoloRound(session: TableSession, guestNo: number, categoryId?: string | null) {
  const { roundId, questionIds } = await createRound({
    restaurantId: session.restaurant_id,
    mode: 'solo',
    sessionId: session.id,
    categoryId: categoryId ?? null,
    startsAt: new Date(),
    durationMinutes: 45,
  });
  const playerId = await addPlayer({
    roundId,
    restaurantId: session.restaurant_id,
    sessionId: session.id,
    tableId: session.table_id,
    guestNo,
  });
  return { roundId, playerId, questionCount: questionIds.length };
}

/**
 * Settle a round's status from the clock and PERSIST it.
 *
 * Rounds are inserted as 'lobby': solo rounds flip immediately, but a table round
 * waits for its 20-second lobby and a restaurant round for the next 5-minute
 * boundary. Only the read paths used to flip the row (and even then in memory),
 * so a player who answered right after the countdown got 409 "The round has not
 * started yet" while the same screen said "active". Doing it here — atomically,
 * against the database clock, before any answer is judged — makes the stored row,
 * the UI and every later read agree.
 */
async function settleRoundStatus(round: {
  id: string;
  status: string;
  starts_at: string;
  ends_at: string | null;
  mode?: string;
}): Promise<'lobby' | 'active' | 'finished'> {
  // A restaurant game needs at least RESTAURANT_MIN_TABLES tables. Once joining has closed (and
  // again at the start, in case somebody quit during the rules) too few tables = it never runs.
  if (round.status === 'lobby' && round.mode === 'restaurant' && round.starts_at) {
    const joinClosesMs = new Date(round.starts_at).getTime() - SYNC_INSTRUCTION_SECONDS * 1000;
    if ((await dbNowMs()) >= joinClosesMs && (await countTables(round.id)) < RESTAURANT_MIN_TABLES) {
      await cancelRestaurantRound(round.id, 'not_enough_tables');
    }
  }
  if (round.status === 'lobby') {
    await db.query(
      `update game_rounds set status = 'active'
        where id = $1 and status = 'lobby' and starts_at <= now()`,
      [round.id],
    );
  }
  if (round.status === 'lobby' || round.status === 'active') {
    await db.query(
      `update game_rounds set status = 'finished'
        where id = $1 and status = 'active' and ends_at is not null and ends_at <= now()`,
      [round.id],
    );
  }
  const fresh = await db.one<{ status: 'lobby' | 'active' | 'finished'; cancel_reason: string | null }>(
    `select status, cancel_reason from game_rounds where id = $1`,
    [round.id],
  );
  const status = fresh?.status ?? (round.status as 'lobby' | 'active' | 'finished');
  // the clock just ended a whole-restaurant round: work out each table's team score once
  // (a cancelled game never ran, so there is nothing to score)
  if (status === 'finished' && round.mode === 'restaurant' && !fresh?.cancel_reason) {
    await finalizeRestaurantRound(round.id);
  }
  return status;
}

/** Tables that still have somebody in a round. */
async function countTables(roundId: string): Promise<number> {
  const row = await db.one<{ c: number }>(
    `select count(distinct table_id)::int as c from game_players
      where round_id = $1 and left_at is null and table_id is not null`,
    [roundId],
  );
  return row?.c ?? 0;
}

async function cancelRestaurantRound(roundId: string, reason: 'not_enough_tables' | 'admin') {
  await db.query(
    `update game_rounds set status = 'finished', cancel_reason = $2, ends_at = now()
      where id = $1 and mode = 'restaurant' and status = 'lobby'`,
    [roundId, reason],
  );
}

// ---------------------------------------------------------------- table mode
/** Guests of a round who have not left it (the guest asking is excluded when given). */
async function countStillPlaying(roundId: string, exceptPlayerId: string | null) {
  const row = await db.one<{ c: number }>(
    `select count(*)::int as c from game_players
      where round_id = $1 and left_at is null
        and ($2::uuid is null or id <> $2::uuid)`,
    [roundId, exceptPlayerId],
  );
  return row?.c ?? 0;
}

export async function startTableRound(session: TableSession, guestNo: number, categoryId?: string | null) {
  // one game per table visit at a time
  const existing = await db.one<any>(
    `select * from game_rounds
      where session_id = $1 and mode = 'table' and status in ('lobby','active')
      order by created_at desc limit 1`,
    [session.id],
  );
  if (existing) {
    const status = await settleRoundStatus(existing);
    if (status !== 'finished') {
      const me = await db.one<{ id: string; left_at: string | null }>(
        `select id, left_at from game_players
          where round_id = $1 and session_id = $2 and guest_no = $3`,
        [existing.id, session.id, guestNo],
      );
      const others = await countStillPlaying(existing.id, me?.id ?? null);
      if (others === 0 && (!me || me.left_at)) {
        // nobody is in that game any more: it is over, a new one starts below
        await db.query(`update game_rounds set status = 'finished' where id = $1`, [existing.id]);
      } else if (me) {
        // already in (a reload, or "Play with my table" tapped twice): carry on with it
        if (me.left_at) throw new GameError('You left this game. You can join the next round.', 409);
        return { roundId: existing.id };
      } else if (status === 'lobby') {
        // a friend joins during the lobby
        await addPlayer({
          roundId: existing.id,
          restaurantId: session.restaurant_id,
          sessionId: session.id,
          tableId: session.table_id,
          guestNo,
        });
        return { roundId: existing.id };
      } else {
        // nobody joins once the first question is out
        throw new GameError('This game has already started. You can join the next round.', 409);
      }
    }
  }

  const settings = await getGameSettings(session.restaurant_id);
  const questionIds = await pickQuestions({
    restaurantId: session.restaurant_id,
    categoryId: categoryId ?? null,
    count: settings.roundsPerRound,
    sessionId: session.id,
  });
  if (questionIds.length === 0) throw new GameError('No quiz questions available yet.', 409);

  // 25 s lobby: friends join and everybody reads how points work. Then 10 questions of 15 s each.
  const startsAt = new Date((await dbNowMs()) + SYNC_INSTRUCTION_SECONDS * 1000);
  const round = await db.one<{ id: string }>(
    `insert into game_rounds (restaurant_id, mode, status, session_id, category_id, question_ids,
                              question_count, starts_at, ends_at)
     values ($1,'table','lobby',$2,$3,$4,$5,$6,$7) returning id`,
    [
      session.restaurant_id,
      session.id,
      categoryId ?? null,
      questionIds,
      questionIds.length,
      startsAt.toISOString(),
      new Date(startsAt.getTime() + questionIds.length * SYNC_QUESTION_MS).toISOString(),
    ],
  );
  await addPlayer({
    roundId: round!.id,
    restaurantId: session.restaurant_id,
    sessionId: session.id,
    tableId: session.table_id,
    guestNo,
  });
  return { roundId: round!.id };
}

/**
 * A guest quits a "with my table" or whole-restaurant game (Quit, or the phone's Back).
 * Their game is over and they cannot come back to that round; everybody else plays on.
 * Solo games are not affected.
 */
export async function leaveTableRound(input: {
  roundId: string;
  restaurantId: string;
  sessionId: string;
  guestNo: number;
}) {
  const round = await db.one<any>(
    `select * from game_rounds where id = $1 and restaurant_id = $2`,
    [input.roundId, input.restaurantId],
  );
  if (!round) throw new GameError('Round not found.', 404);
  if (round.mode === 'solo') return { left: false };
  if ((await settleRoundStatus(round)) === 'finished') return { left: false };

  const rows = await db.query<{ id: string }>(
    `update game_players set left_at = now()
      where round_id = $1 and session_id = $2 and guest_no = $3 and left_at is null
      returning id`,
    [round.id, input.sessionId, input.guestNo],
  );
  return { left: rows.length > 0 };
}

// ---------------------------------------------------------------- restaurant mode
/**
 * Public round that starts at every 5-minute boundary. Players join during the lobby window
 * (closing SYNC_INSTRUCTION_SECONDS before `starts_at`, so everybody gets time to read the
 * rules). Everybody then sees the same question at the same time, 15 s each.
 */
/**
 * The restaurant game that is on right now (open for joining, about to start, or running), or
 * null. One cheap query when nothing is on, which is almost always.
 */
export async function getCurrentRestaurantGame(restaurantId: string) {
  const round = await db.one<any>(
    `select * from game_rounds
      where restaurant_id = $1 and mode = 'restaurant' and status in ('lobby','active')
      order by created_at desc limit 1`,
    [restaurantId],
  );
  if (!round) return null;
  const status = await settleRoundStatus(round); // the clock may just have started, ended or cancelled it
  if (status === 'finished') return null;
  return { ...round, status } as any;
}

/** Brings every unfinished restaurant game up to date with the clock (works out ended ones). */
async function settleDueRestaurantRounds(restaurantId: string) {
  const open = await db.query<any>(
    `select * from game_rounds
      where restaurant_id = $1 and mode = 'restaurant' and status in ('lobby','active')`,
    [restaurantId],
  );
  for (const r of open) await settleRoundStatus(r);
}

/**
 * ADMIN: start a restaurant game. Phones get a banner (through the normal state poll), joining stays
 * open for RESTAURANT_JOIN_WINDOW_SECONDS, then SYNC_INSTRUCTION_SECONDS to read the rules, then the
 * match starts by itself. Everything after this press is automatic.
 */
export async function startRestaurantGame(restaurantId: string) {
  if (await getCurrentRestaurantGame(restaurantId)) {
    throw new GameError('A restaurant game is already on. Wait for it to end, or cancel it first.', 409);
  }
  const settings = await getGameSettings(restaurantId);
  const questionIds = await pickQuestions({ restaurantId, categoryId: null, count: settings.roundsPerRound });
  if (questionIds.length === 0) throw new GameError('No quiz questions available yet.', 409);

  const startsMs = (await dbNowMs()) + (RESTAURANT_JOIN_WINDOW_SECONDS + SYNC_INSTRUCTION_SECONDS) * 1000;
  try {
    const row = await db.one<{ id: string }>(
      `insert into game_rounds (restaurant_id, mode, status, question_ids, question_count, starts_at, ends_at)
       values ($1,'restaurant','lobby',$2,$3,$4,$5) returning id`,
      [
        restaurantId,
        questionIds,
        questionIds.length,
        new Date(startsMs).toISOString(),
        new Date(startsMs + questionIds.length * SYNC_QUESTION_MS).toISOString(),
      ],
    );
    return { roundId: row!.id, startsAt: new Date(startsMs).toISOString() };
  } catch (err: any) {
    // two presses at once: the one-open-game-per-restaurant index caught the second
    if (err?.code === '23505') throw new GameError('A restaurant game is already on.', 409);
    throw err;
  }
}

/** ADMIN: call off a game that has not started yet (a wrong press). */
export async function cancelRestaurantGame(restaurantId: string) {
  const current = await getCurrentRestaurantGame(restaurantId);
  if (!current) throw new GameError('There is no restaurant game to cancel.', 409);
  if (current.status !== 'lobby') throw new GameError('The game has already started.', 409);
  await cancelRestaurantRound(current.id, 'admin');
  return { cancelled: true };
}

export async function joinRestaurantRound(
  session: TableSession,
  guestNo: number,
  roundId: string,
  displayName?: string,
) {
  // A restaurant round is open to the whole restaurant. A TABLE round is open to
  // the phones at that table only, so the second phone uses this same endpoint.
  const round = await db.one<any>(
    `select * from game_rounds where id = $1 and restaurant_id = $2`,
    [roundId, session.restaurant_id],
  );
  if (!round) throw new GameError('That round no longer exists.', 404);

  // a solo round is one phone's own game — joining it would leak its score
  if (round.mode === 'solo') throw new GameError('Solo rounds cannot be joined.', 403);
  if (round.mode === 'table' && round.session_id !== session.id) {
    throw new GameError('This round belongs to another table.', 403);
  }

  // settle the stored status first, or a lobby that has just elapsed still looks un-started
  const status = await settleRoundStatus(round);
  if (status === 'finished') {
    const why = await db.one<{ cancel_reason: string | null }>(`select cancel_reason from game_rounds where id = $1`, [roundId]);
    throw new GameError(
      why?.cancel_reason ? 'This game was cancelled.' : 'That round has already finished.',
      409,
    );
  }

  // already in this round (a reload or a second tap): hand back the same seat
  const mine = await db.one<{ id: string; left_at: string | null }>(
    `select id, left_at from game_players where round_id = $1 and session_id = $2 and guest_no = $3`,
    [roundId, session.id, guestNo],
  );
  if (mine) {
    if (mine.left_at) throw new GameError('You left this round. You can join the next one.', 409);
    return { roundId, playerId: mine.id, status, startsAt: round.starts_at };
  }

  // nobody joins once the first question is out; a whole-restaurant round also closes its
  // doors SYNC_INSTRUCTION_SECONDS earlier so every player gets time to read the rules
  if (status !== 'lobby') {
    throw new GameError('This round has already started. You can join the next one.', 409);
  }
  const startsMs = new Date(round.starts_at).getTime();
  const nowMs = await dbNowMs();
  if (round.mode === 'restaurant' && nowMs > startsMs - SYNC_INSTRUCTION_SECONDS * 1000) {
    throw new GameError('Joining for this round has closed. You can join the next one.', 409);
  }
  if (nowMs > startsMs) throw new GameError('This round has already started.', 409);

  if (round.mode === 'restaurant') {
    // at most RESTAURANT_MAX_PLAYERS_PER_TABLE phones per table. The round row is locked while
    // the seat is counted and taken, so two phones cannot both grab the last one.
    const playerId = await transaction(async (tx) => {
      await tx.one(`select id from game_rounds where id = $1 for update`, [roundId]);
      const taken = await tx.one<{ c: number }>(
        `select count(*)::int as c from game_players
          where round_id = $1 and table_id = $2 and left_at is null`,
        [roundId, session.table_id],
      );
      if ((taken?.c ?? 0) >= RESTAURANT_MAX_PLAYERS_PER_TABLE) {
        throw new GameError(
          `Max ${RESTAURANT_MAX_PLAYERS_PER_TABLE} players per table in the restaurant game.`,
          409,
        );
      }
      const row = await tx.one<{ id: string }>(
        `insert into game_players (restaurant_id, round_id, session_id, table_id, guest_no, display_name)
         values ($1,$2,$3,$4,$5,$6)
         on conflict (round_id, session_id, guest_no) do update set display_name = excluded.display_name
         returning id`,
        [
          session.restaurant_id,
          roundId,
          session.id,
          session.table_id,
          guestNo,
          sanitizeText(displayName ?? '', 24) || `Guest ${guestNo}`,
        ],
      );
      return row!.id;
    });
    return { roundId, playerId, status, startsAt: round.starts_at };
  }

  const playerId = await addPlayer({
    roundId,
    restaurantId: session.restaurant_id,
    sessionId: session.id,
    tableId: session.table_id,
    guestNo,
    displayName,
  });
  return { roundId, playerId, status, startsAt: round.starts_at };
}

// ---------------------------------------------------------------- round state
export type SafeQuestion = {
  index: number;
  id: string;
  question: string;
  options: string[];
};

/**
 * Public projection of a round. Correct answers and explanations are NEVER
 * included here unless the player has already answered that question.
 */
export async function getRoundState(input: {
  roundId: string;
  restaurantId: string;
  sessionId: string;
  guestNo: number;
}) {
  const round = await db.one<any>(
    `select r.*, c.name as category_name from game_rounds r
       left join quiz_categories c on c.id = r.category_id
      where r.id = $1 and r.restaurant_id = $2`,
    [input.roundId, input.restaurantId],
  );
  if (!round) throw new GameError('Round not found.', 404);

  // the clock decides, and the row is updated to match (see settleRoundStatus)
  const status = await settleRoundStatus(round);
  const nowMs = await dbNowMs();

  // Table and whole-restaurant games run on the server clock: question i is on screen during
  // [starts_at + i*15s, starts_at + (i+1)*15s). Nothing about it is decided by the phone.
  const sync = round.mode !== 'solo';
  const startsMs = round.starts_at ? new Date(round.starts_at).getTime() : nowMs;
  const currentIndex =
    sync && status === 'active'
      ? Math.min(round.question_count - 1, Math.max(0, Math.floor((nowMs - startsMs) / SYNC_QUESTION_MS)))
      : null;
  // while a sync game is on, nobody sees points, who is right, or the answers
  const hidden = sync && status !== 'finished';

  const questions = await db.query<any>(
    `select id, question, options, correct_index, explanation, category_id
       from quiz_questions where id = any($1::uuid[])`,
    [round.question_ids],
  );
  const byId = new Map(questions.map((q) => [q.id, q]));

  const player = await db.one<any>(
    `select * from game_players where round_id = $1 and session_id = $2 and guest_no = $3`,
    [round.id, input.sessionId, input.guestNo],
  );

  const answers = player
    ? await db.query<any>(
        `select question_index, question_id, selected_index, is_correct, ms_taken, points
           from game_answers where player_id = $1 order by question_index`,
        [player.id],
      )
    : [];

  const answeredIdx = new Set(answers.map((a) => a.question_index));
  const revealAll = status === 'finished';
  const left = Boolean(player?.left_at);

  // A running sync game only hands out the questions up to the one on screen, so nobody can
  // read ahead (or look up) what is coming. The final state returns all of them.
  const lastVisible = !sync || status === 'finished' ? round.question_ids.length - 1 : currentIndex ?? -1;
  const safeQuestions: SafeQuestion[] = round.question_ids
    .map((qid: string, index: number) => {
      const q = byId.get(qid);
      const opts: string[] = Array.isArray(q?.options) ? q.options : [];
      return { index, id: qid, question: q?.question ?? '', options: opts };
    })
    .filter((q: SafeQuestion) => q.index <= lastVisible);

  const players = await db.query<any>(
    `select gp.id, gp.display_name, gp.guest_no, gp.score, gp.correct_count, gp.answered_count,
            gp.total_ms, gp.table_id, gp.left_at, t.number as table_number
       from game_players gp left join tables t on t.id = gp.table_id
      where gp.round_id = $1 order by gp.score desc, gp.total_ms asc`,
    [round.id],
  );

  const myAnswers = answers.map((a) => {
    const q = byId.get(a.question_id);
    if (hidden) {
      // answered, nothing more: no right/wrong, no points, no correct option
      return {
        questionIndex: a.question_index,
        selectedIndex: a.selected_index,
        isCorrect: null,
        msTaken: 0,
        points: null,
        correctIndex: null,
        explanation: null,
      };
    }
    return {
      questionIndex: a.question_index,
      selectedIndex: a.selected_index,
      isCorrect: a.is_correct as boolean | null,
      msTaken: a.ms_taken,
      points: a.points as number | null,
      correctIndex: revealAll || a.is_correct !== null ? q?.correct_index ?? null : null,
      explanation: q?.explanation ?? null,
    };
  });

  // who is in the lobby: for a whole-restaurant round, tables with a small "N players" line
  const present = players.filter((p) => !p.left_at);
  const tableCounts = new Map<number, number>();
  for (const p of present) {
    if (p.table_number == null) continue;
    tableCounts.set(p.table_number, (tableCounts.get(p.table_number) ?? 0) + 1);
  }
  const lobbyTables = [...tableCounts.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([tableNumber, count]) => ({ tableNumber, players: count }));

  const joinClosesMs =
    round.mode === 'restaurant' ? startsMs - SYNC_INSTRUCTION_SECONDS * 1000 : startsMs;

  return {
    round: {
      id: round.id,
      mode: round.mode as 'solo' | 'table' | 'restaurant',
      status,
      questionCount: round.question_count,
      startsAt: round.starts_at,
      endsAt: round.ends_at,
      categoryName: round.category_name,
      serverNow: new Date(nowMs).toISOString(),
      answeredCount: answeredIdx.size,
      /** sync games: seconds per question; solo keeps its own 25 s on the phone */
      questionSeconds: sync ? SYNC_QUESTION_SECONDS : null,
      instructionSeconds: SYNC_INSTRUCTION_SECONDS,
      joinClosesAt: new Date(joinClosesMs).toISOString(),
      /** the question on screen right now (sync games only) */
      currentIndex,
      /** a restaurant game that never ran: 'not_enough_tables' | 'admin' */
      cancelReason: (round.cancel_reason ?? null) as string | null,
    },
    player: player
      ? {
          id: player.id,
          displayName: player.display_name,
          guestNo: player.guest_no,
          left,
          score: hidden ? 0 : player.score,
          correctCount: hidden ? 0 : player.correct_count,
          answeredCount: player.answered_count,
        }
      : null,
    questions: safeQuestions,
    myAnswers,
    // scores are zeroed while a sync game is running (nobody gets a hint about anybody)
    players: present.map((p) => ({
      id: p.id,
      name: p.display_name,
      guestNo: p.guest_no,
      tableNumber: p.table_number as number | null,
      score: hidden ? 0 : p.score,
      correctCount: hidden ? 0 : p.correct_count,
      answeredCount: p.answered_count,
      totalMs: hidden ? 0 : p.total_ms,
    })),
    lobbyTables,
  };
}

// ---------------------------------------------------------------- answering
export type AnswerResult = {
  isCorrect: boolean;
  correctIndex: number;
  explanation: string | null;
  points: number;
  totalScore: number;
  correctCount: number;
  finished: boolean;
};

/** What a table / whole-restaurant player gets back: no right-or-wrong, no points, no hints. */
export type SyncAnswerResult = { sync: true; answered: true; questionIndex: number };

export async function submitAnswer(input: {
  roundId: string;
  restaurantId: string;
  sessionId: string;
  guestNo: number;
  questionIndex: number;
  selectedIndex: number;
  /** solo only: the server measures the time itself in table / restaurant games */
  msTaken?: number;
}): Promise<AnswerResult | SyncAnswerResult> {
  const limited = await rateLimit(
    `quiz:${input.sessionId}:${input.guestNo}`,
    QUIZ_ANSWER_RATE_LIMIT.perPlayer,
    QUIZ_ANSWER_RATE_LIMIT.windowSeconds,
  );
  if (!limited.ok) throw new GameError('Slow down a little — too many answers.', 429);

  const round = await db.one<any>(
    `select * from game_rounds where id = $1 and restaurant_id = $2`,
    [input.roundId, input.restaurantId],
  );
  if (!round) throw new GameError('Round not found.', 404);
  // Table and restaurant rounds sit in 'lobby' until their countdown ends; settle
  // the row here so answering right after the start is accepted (was a 409 loop).
  const status = await settleRoundStatus(round);
  if (status === 'lobby') throw new GameError('The round has not started yet.', 409);
  if (status === 'finished') throw new GameError('This round is over.', 409);

  const sync = round.mode !== 'solo';
  const startedAt = new Date(round.starts_at).getTime();
  const endsAt = round.ends_at ? new Date(round.ends_at).getTime() : startedAt + 45 * 60_000;
  if (!sync && Date.now() > endsAt) throw new GameError('Time is up for this round.', 409);

  const player = await db.one<any>(
    `select * from game_players where round_id = $1 and session_id = $2 and guest_no = $3`,
    [round.id, input.sessionId, input.guestNo],
  );
  if (!player) throw new GameError('You have not joined this round.', 403);
  if (player.left_at) throw new GameError('You left this game.', 409);

  const questionId: string | undefined = round.question_ids[input.questionIndex];
  if (!questionId) throw new GameError('Unknown question.', 400);

  const already = await db.one(
    `select 1 from game_answers where player_id = $1 and question_index = $2`,
    [player.id, input.questionIndex],
  );
  if (already) throw new GameError('You already answered that question.', 409);

  const question = await db.one<any>(`select * from quiz_questions where id = $1`, [questionId]);
  if (!question) throw new GameError('Question missing.', 500);

  let msTaken: number;
  if (sync) {
    // ---- server clock: the answer must arrive while ITS question is on screen, and the time
    // taken is measured here, from the moment that question appeared. The phone's clock is
    // not asked and not trusted.
    const nowMs = await dbNowMs();
    if (nowMs < startedAt) throw new GameError('The round has not started yet.', 409);
    const onScreen = Math.floor((nowMs - startedAt) / SYNC_QUESTION_MS);
    if (onScreen >= round.question_count) throw new GameError('This round is over.', 409);
    if (input.questionIndex !== onScreen) {
      throw new GameError(
        input.questionIndex < onScreen ? 'Time is up for that question.' : 'That question has not started yet.',
        409,
      );
    }
    msTaken = Math.max(0, Math.min(SYNC_QUESTION_MS, nowMs - (startedAt + onScreen * SYNC_QUESTION_MS)));
  } else {
    // ---- anti-cheat: reported time cannot beat the wall clock
    if (input.msTaken === undefined) throw new GameError('Time taken is required.', 400);
    const elapsedSinceStart = Math.max(0, Date.now() - startedAt);
    const reportedSoFar = Number(player.total_ms ?? 0);
    const maxAllowed = Math.max(0, elapsedSinceStart + 2000 - reportedSoFar);
    msTaken = Math.min(Math.max(0, Math.round(input.msTaken)), maxAllowed, 120_000);
  }

  const settings = await getGameSettings(input.restaurantId);
  const isCorrect = input.selectedIndex === question.correct_index;
  // faster is worth more: the bonus shrinks over the whole question window (15 s in sync games)
  const bonusWindowMs = sync ? SYNC_QUESTION_MS : settings.speedBonusWindowMs;
  const speedBonus = isCorrect
    ? Math.max(0, Math.round(settings.speedBonusMax * (1 - msTaken / bonusWindowMs)))
    : 0;
  const points = isCorrect ? settings.pointsCorrect + speedBonus : 0;

  await transaction(async (tx) => {
    await tx.query(
      `insert into game_answers (restaurant_id, round_id, player_id, question_index, question_id,
                                 selected_index, is_correct, ms_taken, points)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        input.restaurantId,
        round.id,
        player.id,
        input.questionIndex,
        questionId,
        input.selectedIndex,
        isCorrect,
        msTaken,
        points,
      ],
    );
    await tx.query(
      `update game_players set
         score = score + $2,
         correct_count = correct_count + $3,
         answered_count = answered_count + 1,
         total_ms = total_ms + $4
       where id = $1`,
      [player.id, points, isCorrect ? 1 : 0, msTaken],
    );
  });

  // table / whole-restaurant: say only "got it". The score, who was right and the answers all
  // wait for the end of the round, so nobody (least of all a teammate) gets a hint.
  if (sync) return { sync: true, answered: true, questionIndex: input.questionIndex };

  const updated = await db.one<any>(`select * from game_players where id = $1`, [player.id]);
  const finished = (updated?.answered_count ?? 0) >= round.question_count;

  if (finished) await finalisePlayerRound(round.id, player.id);

  return {
    isCorrect,
    correctIndex: question.correct_index,
    explanation: question.explanation ?? null,
    points,
    totalScore: updated?.score ?? 0,
    correctCount: updated?.correct_count ?? 0,
    finished,
  } satisfies AnswerResult;
}

/**
 * Team scores for a whole-restaurant round, worked out once when it ends.
 *
 * Per question, a table scores only if EVERY one of its players answered correctly; it then
 * gets the AVERAGE of their points (100 + speed bonus). One wrong or missing answer = 0 for
 * the table on that question. A player who quit is left out from the question they left on.
 */
async function finalizeRestaurantRound(roundId: string) {
  // already worked out (the common case once a round is over): no lock, no transaction
  if (await db.one(`select 1 from game_scores where round_id = $1 limit 1`, [roundId])) return;
  await transaction(async (tx) => {
    // lock the round row so two requests finishing it together do the work only once
    const round = await tx.one<any>(`select * from game_rounds where id = $1 for update`, [roundId]);
    if (!round || round.mode !== 'restaurant' || !round.starts_at) return;
    const done = await tx.one(`select 1 from game_scores where round_id = $1 limit 1`, [roundId]);
    if (done) return;

    const players = await tx.query<any>(
      `select id, table_id, session_id, left_at from game_players
        where round_id = $1 and table_id is not null order by joined_at`,
      [roundId],
    );
    if (players.length === 0) return;
    const answers = await tx.query<any>(
      `select player_id, question_index, is_correct, points from game_answers where round_id = $1`,
      [roundId],
    );
    const byPlayer = new Map<string, Map<number, { ok: boolean; points: number }>>();
    for (const a of answers) {
      if (!byPlayer.has(a.player_id)) byPlayer.set(a.player_id, new Map());
      byPlayer.get(a.player_id)!.set(a.question_index, { ok: Boolean(a.is_correct), points: a.points });
    }
    const byTable = new Map<string, any[]>();
    for (const p of players) {
      if (!byTable.has(p.table_id)) byTable.set(p.table_id, []);
      byTable.get(p.table_id)!.push(p);
    }

    const startMs = new Date(round.starts_at).getTime();
    for (const [tableId, members] of byTable) {
      let total = 0;
      let questionsWon = 0;
      for (let q = 0; q < round.question_count; q++) {
        const windowEnd = startMs + (q + 1) * SYNC_QUESTION_MS;
        const counted = members.filter((m) => !m.left_at || new Date(m.left_at).getTime() >= windowEnd);
        if (counted.length === 0) continue;
        let everyoneRight = true;
        let sum = 0;
        for (const m of counted) {
          const a = byPlayer.get(m.id)?.get(q);
          if (!a || !a.ok) {
            everyoneRight = false;
            break;
          }
          sum += a.points;
        }
        if (everyoneRight) {
          total += Math.round(sum / counted.length);
          questionsWon++;
        }
      }
      await tx.query(
        `insert into game_scores (restaurant_id, round_id, session_id, table_id, mode, points, correct_count, play_date)
         values ($1,$2,$3,$4,'restaurant',$5,$6,(($7::timestamptz) at time zone 'Asia/Kolkata')::date)`,
        [round.restaurant_id, roundId, members[0].session_id, tableId, total, questionsWon, round.starts_at],
      );
    }
  });
}

/** Records the daily leaderboard row for a player's table once they finish. */
async function finalisePlayerRound(roundId: string, playerId: string) {
  const player = await db.one<any>(`select * from game_players where id = $1`, [playerId]);
  if (!player || !player.table_id) return;
  const round = await db.one<any>(`select * from game_rounds where id = $1`, [roundId]);
  if (!round) return;

  const existing = await db.one(
    `select 1 from game_scores where round_id = $1 and table_id = $2 and mode = $3`,
    [roundId, player.table_id, round.mode],
  );
  if (existing) return;

  const agg = await db.one<any>(
    `select coalesce(sum(score),0)::int as points, coalesce(sum(correct_count),0)::int as correct
       from game_players where round_id = $1 and table_id = $2`,
    [roundId, player.table_id],
  );
  await db.query(
    `insert into game_scores (restaurant_id, round_id, session_id, table_id, mode, points, correct_count, play_date)
     values ($1,$2,$3,$4,$5,$6,$7,(now() at time zone 'Asia/Kolkata')::date)`,
    [
      round.restaurant_id,
      roundId,
      player.session_id,
      player.table_id,
      round.mode,
      agg?.points ?? 0,
      agg?.correct ?? 0,
    ],
  );
}

// ---------------------------------------------------------------- results
export async function getRoundResults(roundId: string, restaurantId: string) {
  const round = await db.one<any>(
    `select * from game_rounds where id = $1 and restaurant_id = $2`,
    [roundId, restaurantId],
  );
  if (!round) throw new GameError('Round not found.', 404);

  // Answers and scores of a table / whole-restaurant game stay hidden until it is over
  // (the page would otherwise hand the correct answers to someone still playing).
  if (round.mode !== 'solo' && (await settleRoundStatus(round)) !== 'finished') {
    throw new GameError('Results appear when the round ends.', 409);
  }

  const [players, tableRows, questionRows] = await Promise.all([
    db.query<any>(
      `select gp.*, t.number as table_number from game_players gp
         left join tables t on t.id = gp.table_id
        where gp.round_id = $1 order by gp.score desc, gp.total_ms asc`,
      [roundId],
    ),
    db.query<any>(
      `select gs.table_id, t.number as table_number, gs.points, gs.correct_count,
              (select count(*)::int from game_players gp
                where gp.round_id = gs.round_id and gp.table_id = gs.table_id
                  and (gp.left_at is null
                       or gp.left_at >= (select starts_at from game_rounds where id = gs.round_id))) as members
         from game_scores gs join tables t on t.id = gs.table_id
        where gs.round_id = $1 order by gs.points desc`,
      [roundId],
    ),
    db.query<any>(
      `select id, question, options, correct_index, explanation
         from quiz_questions where id = any($1::uuid[])`,
      [round.question_ids],
    ),
  ]);

  const qById = new Map(questionRows.map((q) => [q.id, q]));
  const questions = round.question_ids.map((id: string, index: number) => {
    const q = qById.get(id);
    return {
      index,
      question: q?.question ?? '',
      options: q?.options ?? [],
      correctIndex: q?.correct_index ?? 0,
      explanation: q?.explanation ?? null,
    };
  });

  return {
    round: {
      id: round.id,
      mode: round.mode,
      status: round.status,
      categoryName: null,
      questionCount: round.question_count,
    },
    players: players.map((p) => ({
      id: p.id,
      name: p.display_name,
      tableNumber: p.table_number,
      score: p.score,
      correctCount: p.correct_count,
      answeredCount: p.answered_count,
      totalMs: p.total_ms,
    })),
    tables: tableRows.map((t) => ({
      tableId: t.table_id,
      tableNumber: t.table_number,
      points: t.points,
      correctCount: t.correct_count,
      members: t.members as number,
    })),
    questions,
  };
}

// ---------------------------------------------------------------- leaderboard
export async function getDailyLeaderboard(restaurantId: string) {
  await settleDueRestaurantRounds(restaurantId); // rounds that just ended count straight away
  const settings = await getGameSettings(restaurantId);
  const mode = settings.pointsMode;
  const rows = await db.query<any>(
    `select gs.table_id, t.number as table_number,
            sum(gs.points)::int as total_points,
            round(case when $2 = 'average' then avg(gs.points) else sum(gs.points) end, 0)::int as points,
            count(*)::int as rounds,
            sum(gs.correct_count)::int as correct
       from game_scores gs
       join tables t on t.id = gs.table_id
      where gs.restaurant_id = $1
        and gs.play_date = (now() at time zone 'Asia/Kolkata')::date
        and gs.mode = 'restaurant'
      group by gs.table_id, t.number
      order by points desc, total_points desc
      limit 20`,
    [restaurantId, mode],
  );

  // prizes are shown to guests only while the admin has the switch on (and only the active ones)
  const prizes = settings.showPrizes
    ? await db.query<any>(
        `select rank, title, description from prizes
          where restaurant_id = $1 and is_active order by rank`,
        [restaurantId],
      )
    : [];

  return {
    date:
      (await db.one<{ d: string }>(`select (now() at time zone 'Asia/Kolkata')::date::text as d`))?.d ?? '',
    pointsMode: mode,
    rows: rows.map((r, i) => ({
      rank: i + 1,
      tableNumber: r.table_number,
      points: r.points,
      rounds: r.rounds,
      correct: r.correct,
      prize: prizes.find((p) => p.rank === i + 1) ?? null,
    })),
  };
}

// ---------------------------------------------------------------- admin CRUD
export async function saveQuizQuestion(
  restaurantId: string,
  input: {
    id?: string;
    categoryId: string;
    question: string;
    options: string[];
    correctIndex: number;
    explanation?: string | null;
    difficulty: number;
    isActive: boolean;
  },
) {
  const question = sanitizeText(input.question, 300);
  const options = input.options.map((o) => sanitizeText(o, 120));
  const explanation = input.explanation ? sanitizeText(input.explanation, 300) : null;

  if (input.id) {
    await db.query(
      `update quiz_questions set category_id=$2, question=$3, options=$4, correct_index=$5,
              explanation=$6, difficulty=$7, is_active=$8 where id=$1 and restaurant_id=$9`,
      [
        input.id,
        input.categoryId,
        question,
        JSON.stringify(options),
        input.correctIndex,
        explanation,
        input.difficulty,
        input.isActive,
        restaurantId,
      ],
    );
    return input.id;
  }
  const row = await db.one<{ id: string }>(
    `insert into quiz_questions (restaurant_id, category_id, question, options, correct_index,
                                 explanation, difficulty, is_active)
     values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
    [
      restaurantId,
      input.categoryId,
      question,
      JSON.stringify(options),
      input.correctIndex,
      explanation,
      input.difficulty,
      input.isActive,
    ],
  );
  return row!.id;
}

export async function listQuizQuestions(restaurantId: string, categoryId?: string) {
  return db.query<any>(
    `select q.*, c.name as category_name from quiz_questions q
       join quiz_categories c on c.id = q.category_id
      where q.restaurant_id = $1 and ($2::uuid is null or q.category_id = $2::uuid)
      order by c.sort_order, q.created_at desc`,
    [restaurantId, categoryId ?? null],
  );
}

export async function deleteQuizQuestion(restaurantId: string, id: string) {
  await db.query(`delete from quiz_questions where id = $1 and restaurant_id = $2`, [id, restaurantId]);
}

/**
 * Bulk import. CSV columns:
 *   question,option1,option2,option3,option4,correct(1-4),explanation,difficulty
 * Tolerant of quoted commas.
 */
export function parseQuestionCsv(csv: string) {
  const rows: string[][] = [];
  let cell = '';
  let row: string[] = [];
  let quoted = false;

  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i];
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const valid: {
    question: string;
    options: string[];
    correctIndex: number;
    explanation: string | null;
    difficulty: number;
  }[] = [];
  const errors: { line: number; message: string }[] = [];

  rows.forEach((r, i) => {
    if (i === 0 && /question/i.test(r[0] ?? '')) return; // header
    if (!r.some((c) => c.trim())) return;
    if (r.length < 6) {
      errors.push({ line: i + 1, message: 'Expected at least 6 columns' });
      return;
    }
    const [question, o1, o2, o3, o4, correct, explanation, difficulty] = r;
    const n = Number.parseInt(String(correct).trim(), 10);
    if (!question?.trim() || !o1?.trim() || !o2?.trim() || !o3?.trim() || !o4?.trim()) {
      errors.push({ line: i + 1, message: 'Missing question or option text' });
      return;
    }
    if (!Number.isInteger(n) || n < 1 || n > 4) {
      errors.push({ line: i + 1, message: 'correct must be 1-4' });
      return;
    }
    valid.push({
      question: question.trim(),
      options: [o1.trim(), o2.trim(), o3.trim(), o4.trim()],
      correctIndex: n - 1,
      explanation: explanation?.trim() || null,
      difficulty: Math.min(3, Math.max(1, Number.parseInt(difficulty ?? '1', 10) || 1)),
    });
  });

  return { valid, errors };
}

export async function importQuestions(restaurantId: string, categoryId: string, csv: string) {
  const { valid, errors } = parseQuestionCsv(csv);
  let inserted = 0;
  for (const q of valid) {
    await db.query(
      `insert into quiz_questions (restaurant_id, category_id, question, options, correct_index,
                                   explanation, difficulty)
       values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        restaurantId,
        categoryId,
        sanitizeText(q.question, 300),
        JSON.stringify(q.options.map((o) => sanitizeText(o, 120))),
        q.correctIndex,
        q.explanation ? sanitizeText(q.explanation, 300) : null,
        q.difficulty,
      ],
    );
    inserted++;
  }
  return { inserted, errors, skipped: errors.length };
}

export async function saveQuizCategory(
  restaurantId: string,
  input: { id?: string; name: string; emoji?: string | null; sortOrder: number; isActive: boolean },
) {
  const name = sanitizeText(input.name, 60);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `cat-${Date.now()}`;
  if (input.id) {
    await db.query(
      `update quiz_categories set name=$2, emoji=$3, sort_order=$4, is_active=$5
        where id=$1 and restaurant_id=$6`,
      [input.id, name, input.emoji ?? null, input.sortOrder, input.isActive, restaurantId],
    );
    return input.id;
  }
  const row = await db.one<{ id: string }>(
    `insert into quiz_categories (restaurant_id, name, slug, emoji, sort_order, is_active)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [restaurantId, name, `${slug}-${Math.random().toString(36).slice(2, 6)}`, input.emoji ?? null, input.sortOrder, input.isActive],
  );
  return row!.id;
}

export async function listPrizes(restaurantId: string) {
  return db.query<any>(
    `select * from prizes where restaurant_id = $1 order by rank`,
    [restaurantId],
  );
}

export async function savePrize(
  restaurantId: string,
  input: { rank: number; title: string; description?: string | null; isActive: boolean },
) {
  const title = sanitizeText(input.title, 80);
  const description = input.description ? sanitizeText(input.description, 200) : null;

  // One prize per rank: change the one that is there, add one only if there is none.
  // (This used to insert a new row on every save, so an "edited" or "hidden" prize kept
  // living on in its older copy.)
  const rows = await db.query<{ id: string }>(
    `select id from prizes where restaurant_id = $1 and rank = $2 order by created_at, id`,
    [restaurantId, input.rank],
  );
  if (rows.length === 0) {
    await db.query(
      `insert into prizes (restaurant_id, rank, title, description, is_active) values ($1,$2,$3,$4,$5)`,
      [restaurantId, input.rank, title, description, input.isActive],
    );
    return;
  }
  await db.query(`update prizes set title = $2, description = $3, is_active = $4 where id = $1`, [
    rows[0].id,
    title,
    description,
    input.isActive,
  ]);
  // clear out the copies earlier saves left behind
  await db.query(`delete from prizes where restaurant_id = $1 and rank = $2 and id <> $3`, [
    restaurantId,
    input.rank,
    rows[0].id,
  ]);
}

export async function deletePrize(restaurantId: string, rank: number) {
  await db.query(`delete from prizes where restaurant_id = $1 and rank = $2`, [restaurantId, rank]);
}


/**
 * For the Games page: is there a table game this phone can join (still in its 25 s lobby),
 * or one it is already in? Friends at the table have no other way to know a game was started.
 */
export async function getTableRoundForLobby(session: TableSession, guestNo: number) {
  const round = await db.one<any>(
    `select * from game_rounds
      where session_id = $1 and mode = 'table' and status in ('lobby','active')
      order by created_at desc limit 1`,
    [session.id],
  );
  if (!round) return null;
  const status = await settleRoundStatus(round);
  if (status === 'finished') return null;
  const me = await db.one<{ id: string; left_at: string | null }>(
    `select id, left_at from game_players where round_id = $1 and session_id = $2 and guest_no = $3`,
    [round.id, session.id, guestNo],
  );
  const count = await countStillPlaying(round.id, null);
  const joined = Boolean(me) && !me!.left_at;
  // nothing to show a phone that can no longer join (game running without it, or it quit)
  if (!joined && status !== 'lobby') return null;
  if (me?.left_at) return null;
  return { id: round.id as string, startsAt: round.starts_at as string, status, joined, players: count };
}


// ---------------------------------------------------------------- restaurant game: what people and the admin see
export type RestaurantGameBanner = RestaurantGameInfo;

/** What the banner on a guest's screen needs. One cheap query when no game is on. */
export async function getRestaurantGameBanner(session: TableSession, guestNo: number): Promise<RestaurantGameBanner> {
  const round = await getCurrentRestaurantGame(session.restaurant_id);
  if (!round) return null;
  const nowMs = await dbNowMs();
  const startsMs = new Date(round.starts_at).getTime();
  const joinClosesMs = startsMs - SYNC_INSTRUCTION_SECONDS * 1000;
  const phase = round.status === 'active' ? 'live' : nowMs >= joinClosesMs ? 'rules' : 'join';
  const mine = await db.one<{ left_at: string | null }>(
    `select left_at from game_players where round_id = $1 and session_id = $2 and guest_no = $3`,
    [round.id, session.id, guestNo],
  );
  const seats = await db.one<{ t: number; mine: number }>(
    `select count(distinct table_id)::int as t,
            count(*) filter (where table_id = $2)::int as mine
       from game_players where round_id = $1 and left_at is null`,
    [round.id, session.table_id],
  );
  return {
    id: round.id,
    phase,
    startsAt: round.starts_at,
    joinClosesAt: new Date(joinClosesMs).toISOString(),
    serverNow: new Date(nowMs).toISOString(),
    joined: Boolean(mine) && !mine!.left_at,
    left: Boolean(mine?.left_at),
    tableFull: (seats?.mine ?? 0) >= RESTAURANT_MAX_PLAYERS_PER_TABLE,
    tables: seats?.t ?? 0,
  };
}

/**
 * ADMIN screen: the game that is on (who has joined, how far it is) and today's matches with their
 * winners. A cancelled game shows why ("not enough tables").
 */
export async function getRestaurantGameAdminView(restaurantId: string) {
  await settleDueRestaurantRounds(restaurantId);
  const nowMs = await dbNowMs();

  const live = await db.one<any>(
    `select * from game_rounds
      where restaurant_id = $1 and mode = 'restaurant' and status in ('lobby','active')
      order by created_at desc limit 1`,
    [restaurantId],
  );
  let current: null | {
    id: string;
    phase: 'join' | 'rules' | 'live';
    startsAt: string;
    joinClosesAt: string;
    serverNow: string;
    questionCount: number;
    currentQuestion: number | null;
    tables: { tableNumber: number; players: string[] }[];
  } = null;
  if (live) {
    const startsMs = new Date(live.starts_at).getTime();
    const joinClosesMs = startsMs - SYNC_INSTRUCTION_SECONDS * 1000;
    const who = await db.query<any>(
      `select t.number as table_number, gp.display_name
         from game_players gp join tables t on t.id = gp.table_id
        where gp.round_id = $1 and gp.left_at is null order by t.number, gp.joined_at`,
      [live.id],
    );
    const byTable = new Map<number, string[]>();
    for (const w of who) byTable.set(w.table_number, [...(byTable.get(w.table_number) ?? []), w.display_name]);
    current = {
      id: live.id,
      phase: live.status === 'active' ? 'live' : nowMs >= joinClosesMs ? 'rules' : 'join',
      startsAt: live.starts_at,
      joinClosesAt: new Date(joinClosesMs).toISOString(),
      serverNow: new Date(nowMs).toISOString(),
      questionCount: live.question_count,
      currentQuestion:
        live.status === 'active'
          ? Math.min(live.question_count, Math.floor((nowMs - startsMs) / SYNC_QUESTION_MS) + 1)
          : null,
      tables: [...byTable.entries()].map(([tableNumber, players]) => ({ tableNumber, players })),
    };
  }

  // today's matches (the restaurant's own day), newest first
  const rounds = await db.query<any>(
    `select id, cancel_reason, starts_at, created_at from game_rounds
      where restaurant_id = $1 and mode = 'restaurant' and status = 'finished'
        and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date
      order by created_at desc limit 20`,
    [restaurantId],
  );
  const prizes = await db.query<any>(
    `select rank, title from prizes where restaurant_id = $1 and is_active order by rank`,
    [restaurantId],
  );
  const prizeByRank = new Map<number, string>(prizes.map((p) => [p.rank, p.title]));

  const matches = [];
  for (const r of rounds) {
    if (r.cancel_reason) {
      const joined = await db.one<{ c: number }>(
        `select count(distinct table_id)::int as c from game_players where round_id = $1 and table_id is not null`,
        [r.id],
      );
      matches.push({
        id: r.id,
        at: r.created_at as string,
        cancelReason: r.cancel_reason as string,
        tablesJoined: joined?.c ?? 0,
        results: [] as any[],
      });
      continue;
    }
    const scores = await db.query<any>(
      `select gs.table_id, t.number as table_number, gs.points, gs.correct_count, gs.prize_given_at
         from game_scores gs join tables t on t.id = gs.table_id
        where gs.round_id = $1
        order by gs.points desc, gs.correct_count desc, t.number asc`,
      [r.id],
    );
    const names = await db.query<any>(
      `select table_id, display_name from game_players
        where round_id = $1
          and (left_at is null or left_at >= $2::timestamptz)   -- not those who quit in the lobby
        order by joined_at`,
      [r.id, r.starts_at],
    );
    matches.push({
      id: r.id,
      at: r.created_at as string,
      cancelReason: null as string | null,
      tablesJoined: scores.length,
      results: scores.map((sc, i) => ({
        rank: i + 1,
        tableId: sc.table_id as string,
        tableNumber: sc.table_number as number,
        points: sc.points as number,
        questionsWon: sc.correct_count as number,
        players: names.filter((n) => n.table_id === sc.table_id).map((n) => n.display_name as string),
        prize: prizeByRank.get(i + 1) ?? null,
        prizeGiven: sc.prize_given_at != null,
      })),
    });
  }
  return { current, matches };
}

/** ADMIN: tick (or untick) "prize given" for a table's result in a match. */
export async function setPrizeGiven(input: { restaurantId: string; roundId: string; tableId: string; given: boolean }) {
  const rows = await db.query<{ table_id: string }>(
    `update game_scores set prize_given_at = case when $4::boolean then now() else null end
      where restaurant_id = $1 and round_id = $2 and table_id = $3 returning table_id`,
    [input.restaurantId, input.roundId, input.tableId, input.given],
  );
  if (rows.length === 0) throw new GameError('Result not found.', 404);
  return { ok: true };
}
