import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, handleApiError, parseBody } from '@/server/api';
import { requireSession } from '@/server/session';
import { getGuestNo } from '@/server/session';
import {
  GameError,
  getDailyLeaderboard,
  getCurrentRestaurantGame,
  getRestaurantGameBanner,
  getQuizCategories,
  getTableRoundForLobby,
  getRoundResults,
  getRoundState,
  joinRestaurantRound,
  leaveTableRound,
  startSoloRound,
  startTableRound,
  submitAnswer,
} from '@/server/repos/games';
import { answerSchema, joinRoundSchema, leaveRoundSchema, startGameSchema } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const tableCode = z.string().min(6).max(64);

/** GET /api/public/games/[action]?t=TABLE_CODE */
export async function GET(req: Request, props: { params: Promise<{ action: string }> }) {
  const { action } = await props.params;
  const url = new URL(req.url);
  const code = tableCode.safeParse(url.searchParams.get('t') ?? '');
  const roundId = url.searchParams.get('roundId') ?? '';

  try {
    if (!code.success) throw new GameError('Invalid table link.', 404);

    switch (action) {
      case 'lobby': {
        const session = await requireSession(code.data);
        const guestNo = await getGuestNo(code.data);
        const [categories, restaurantGame, leaderboard, tableRound] = await Promise.all([
          getQuizCategories(session.restaurant_id),
          getRestaurantGameBanner(session, guestNo),
          getDailyLeaderboard(session.restaurant_id),
          getTableRoundForLobby(session, guestNo),
        ]);
        return NextResponse.json({
          ok: true,
          data: { categories, restaurantGame, leaderboard, tableRound },
        });
      }

      case 'round': {
        const session = await requireSession(code.data);
        if (!z.string().uuid().safeParse(roundId).success) throw new GameError('Round id required.', 400);
        const guestNo = await getGuestNo(code.data);
        const state = await getRoundState({
          roundId,
          restaurantId: session.restaurant_id,
          sessionId: session.id,
          guestNo,
        });
        return NextResponse.json({ ok: true, data: state });
      }

      case 'results': {
        const session = await requireSession(code.data);
        if (!z.string().uuid().safeParse(roundId).success) throw new GameError('Round id required.', 400);
        const results = await getRoundResults(roundId, session.restaurant_id);
        return NextResponse.json({ ok: true, data: results });
      }

      case 'leaderboard': {
        const session = await requireSession(code.data);
        const leaderboard = await getDailyLeaderboard(session.restaurant_id);
        return NextResponse.json({ ok: true, data: leaderboard });
      }

      default:
        return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 404 });
    }
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST /api/public/games/[action] */
export async function POST(req: Request, props: { params: Promise<{ action: string }> }) {
  const { action } = await props.params;

  try {
    assertSameOrigin(req);

    switch (action) {
      case 'start': {
        const body = await parseBody(
          req,
          z.object({ table_code: tableCode, payload: startGameSchema }),
        );
        const session = await requireSession(body.table_code);
        const guestNo = await getGuestNo(body.table_code);

        if (body.payload.mode === 'solo') {
          const out = await startSoloRound(session, guestNo, body.payload.categoryId);
          return NextResponse.json({ ok: true, data: out });
        }
        if (body.payload.mode === 'table') {
          const out = await startTableRound(session, guestNo, body.payload.categoryId);
          return NextResponse.json({ ok: true, data: out });
        }
        // restaurant-wide: join the game the admin started (there is none unless the admin pressed Start)
        const round = await getCurrentRestaurantGame(session.restaurant_id);
        if (!round || round.status !== 'lobby') {
          throw new GameError('There is no restaurant game to join right now.', 409);
        }
        const out = await joinRestaurantRound(session, guestNo, round.id);
        return NextResponse.json({ ok: true, data: out });
      }

      case 'join': {
        const body = await parseBody(
          req,
          z.object({ table_code: tableCode, payload: joinRoundSchema }),
        );
        const session = await requireSession(body.table_code);
        const guestNo = await getGuestNo(body.table_code);
        const out = await joinRestaurantRound(session, guestNo, body.payload.roundId, body.payload.displayName);
        return NextResponse.json({ ok: true, data: out });
      }

      /** Quit a table / whole-restaurant game: it ends for this guest, the others play on. */
      case 'leave': {
        const body = await parseBody(
          req,
          z.object({ table_code: tableCode, payload: leaveRoundSchema }),
        );
        const session = await requireSession(body.table_code);
        const guestNo = await getGuestNo(body.table_code);
        const out = await leaveTableRound({
          roundId: body.payload.roundId,
          restaurantId: session.restaurant_id,
          sessionId: session.id,
          guestNo,
        });
        return NextResponse.json({ ok: true, data: out });
      }

      case 'answer': {
        const body = await parseBody(
          req,
          z.object({ table_code: tableCode, payload: answerSchema }),
        );
        const session = await requireSession(body.table_code);
        const guestNo = await getGuestNo(body.table_code);
        const result = await submitAnswer({
          roundId: body.payload.roundId,
          restaurantId: session.restaurant_id,
          sessionId: session.id,
          guestNo,
          questionIndex: body.payload.questionIndex,
          selectedIndex: body.payload.selectedIndex,
          msTaken: body.payload.msTaken,
        });
        return NextResponse.json({ ok: true, data: result });
      }

      default:
        return NextResponse.json({ ok: false, error: 'Unknown action' }, { status: 404 });
    }
  } catch (err) {
    return handleApiError(err);
  }
}
