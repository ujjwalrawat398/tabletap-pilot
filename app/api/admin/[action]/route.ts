import 'server-only';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { assertSameOrigin, handleApiError, jsonError, parseBody } from '@/server/api';
import { auditLog, createStaffAccount, deleteStaffAccount, requireStaff, resetStaffPassword } from '@/server/auth';
import {
  bulkQuestionsSchema,
  categorySchema,
  menuItemSchema,
  newPartySchema,
  otpDismissSchema,
  passwordDecisionSchema,
  otpRaiseSchema,
  prizeSchema,
  quizCategorySchema,
  quizQuestionSchema,
  settingsSchema,
  soldOutSchema,
  staffSchema,
  staffUpdateSchema,
  tableSchema,
  uuidSchema,
} from '@/lib/validation';
import {
  deleteCategory,
  deleteMenuItem,
  getAdminMenu,
  saveCategory,
  saveMenuItem,
  setItemAvailability,
  setItemOffer,
} from '@/server/repos/menu';
import {
  createTable,
  deleteTable,
  getFeedback,
  getSettings,
  getTablesWithCodes,
  regenerateTableCode,
  updateFeedbackStatus,
  updateRestaurant,
  updateTable,
  getRestaurant,
} from '@/server/repos/service';
import { getDashboardStats, getSalesReport, getAuditLog } from '@/server/repos/reports';
import { listStaff, setStaffActive, setStaffRole, countActiveAdmins } from '@/server/repos/staff';
import { decidePasswordRequest, listPendingRequests } from '@/server/repos/password-requests';
import {
  deletePrize,
  deleteQuizQuestion,
  getDailyLeaderboard,
  cancelRestaurantGame,
  getGameSettings,
  getRestaurantGameAdminView,
  importQuestions,
  listPrizes,
  listQuizQuestions,
  savePrize,
  saveQuizCategory,
  setPrizeGiven,
  startRestaurantGame,
  saveQuizQuestion,
} from '@/server/repos/games';
import { getTableGrid } from '@/server/repos/service';
import { dismissOtp, endAllSessions, listLiveOtps, raiseOtp, startNewParty } from '@/server/repos/otp';
import { db } from '@/server/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function requireAdmin() {
  return requireStaff(['admin']);
}

/** GET /api/admin/[action] */
export async function GET(req: Request, props: { params: Promise<{ action: string }> }) {
  const { action } = await props.params;
  try {
    const user = await requireAdmin();
    const url = new URL(req.url);
    const rid = user.restaurant_id;

    switch (action) {
      case 'overview': {
        const [stats, tables, settings, restaurant] = await Promise.all([
          getDashboardStats(rid),
          getTableGrid(rid),
          getSettings(rid),
          getRestaurant(rid),
        ]);
        return NextResponse.json({ ok: true, data: { stats, tables, settings, restaurant, user } });
      }

      case 'menu':
        return NextResponse.json({ ok: true, data: await getAdminMenu(rid) });

      case 'staff': {
        const [staff, requests] = await Promise.all([listStaff(rid), listPendingRequests(rid)]);
        return NextResponse.json({ ok: true, data: { staff, requests, user } });
      }

      case 'password-requests':
        return NextResponse.json({ ok: true, data: { requests: await listPendingRequests(rid) } });

      case 'tables':
        return NextResponse.json({ ok: true, data: { tables: await getTablesWithCodes(rid) } });

      case 'reports': {
        const from = url.searchParams.get('from') ?? new Date(Date.now() - 6 * 86400_000).toISOString().slice(0, 10);
        const to = url.searchParams.get('to') ?? new Date().toISOString().slice(0, 10);
        const report = await getSalesReport(rid, from, to);
        return NextResponse.json({ ok: true, data: report });
      }

      case 'settings': {
        const [restaurant, settings] = await Promise.all([getRestaurant(rid), getSettings(rid)]);
        return NextResponse.json({ ok: true, data: { restaurant, settings } });
      }

      /** J3 — panic: every session ends, every live code dies, every table goes Free. */
      case 'end-all-sessions': {
        const url = new URL(req.url);
        void url;
        const result = await endAllSessions(rid, { id: user.user_id, email: user.email });
        return NextResponse.json({ ok: true, data: result });
      }

      /** "New party" (G2): close the old visit, keep it in reports, clear the codes. */
      case 'new-party': {
        const url = new URL(req.url);
        const tableId = uuidSchema.parse(url.searchParams.get('tableId'));
        const result = await startNewParty(rid, tableId, {
          id: user.user_id,
          email: user.email,
        });
        return NextResponse.json({ ok: true, data: result });
      }

      /** Codes are visible to admin too (E12). */
      case 'codes':
        return NextResponse.json({ ok: true, data: { otps: await listLiveOtps(rid) } });

      case 'feedback':
        return NextResponse.json({ ok: true, data: { feedback: await getFeedback(rid) } });

      case 'restaurant-game':
        return NextResponse.json({ ok: true, data: await getRestaurantGameAdminView(rid) });

      case 'games': {
        const [categories, questions, prizes, leaderboard, gameSettings] = await Promise.all([
          db.query<any>(`select * from quiz_categories where restaurant_id=$1 order by sort_order`, [rid]),
          listQuizQuestions(rid),
          listPrizes(rid),
          getDailyLeaderboard(rid),
          getGameSettings(rid),
        ]);
        return NextResponse.json({
          ok: true,
          data: { categories, questions, prizes, leaderboard, showPrizes: gameSettings.showPrizes },
        });
      }

      case 'audit':
        return NextResponse.json({ ok: true, data: { entries: await getAuditLog(rid) } });

      default:
        return jsonError('Unknown action', 404);
    }
  } catch (err) {
    return handleApiError(err);
  }
}

/** POST /api/admin/[action] */
export async function POST(req: Request, props: { params: Promise<{ action: string }> }) {
  const { action } = await props.params;
  try {
    assertSameOrigin(req);
    const user = await requireAdmin();
    const rid = user.restaurant_id;

    switch (action) {
      case 'menu-category': {
        const body = await parseBody(req, categorySchema);
        const id = await saveCategory(rid, body);
        await auditLog({
          restaurantId: rid,
          actorId: user.user_id,
          actorEmail: user.email,
          action: body.id ? 'menu.category.update' : 'menu.category.create',
          entity: 'menu_categories',
          entityId: id,
          meta: { name: body.name },
        });
        return NextResponse.json({ ok: true, data: { id } });
      }

      case 'menu-category-delete': {
        const body = await parseBody(req, z.object({ id: uuidSchema }));
        const ok = await deleteCategory(rid, body.id);
        await auditLog({
          restaurantId: rid,
          actorId: user.user_id,
          actorEmail: user.email,
          action: 'menu.category.delete',
          entity: 'menu_categories',
          entityId: body.id,
        });
        return NextResponse.json({ ok: true, data: { deleted: ok } });
      }

      case 'menu-item': {
        const body = await parseBody(req, menuItemSchema);
        const id = await saveMenuItem(rid, body);
        await auditLog({
          restaurantId: rid,
          actorId: user.user_id,
          actorEmail: user.email,
          action: body.id ? 'menu.item.update' : 'menu.item.create',
          entity: 'menu_items',
          entityId: id,
          meta: { name: body.name, price: body.price, offerPrice: body.offerPrice },
        });
        return NextResponse.json({ ok: true, data: { id } });
      }

      case 'menu-item-delete': {
        const body = await parseBody(req, z.object({ id: uuidSchema }));
        const ok = await deleteMenuItem(rid, body.id);
        await auditLog({
          restaurantId: rid,
          actorId: user.user_id,
          actorEmail: user.email,
          action: 'menu.item.delete',
          entity: 'menu_items',
          entityId: body.id,
        });
        return NextResponse.json({ ok: true, data: { deleted: ok } });
      }

      case 'sold-out': {
        const body = await parseBody(req, soldOutSchema);
        const row = await setItemAvailability(rid, body.itemId, body.isAvailable);
        await auditLog({
          restaurantId: rid,
          actorId: user.user_id,
          actorEmail: user.email,
          action: body.isAvailable ? 'menu.item.available' : 'menu.item.sold_out',
          entity: 'menu_items',
          entityId: body.itemId,
          meta: { name: row?.name },
        });
        return NextResponse.json({ ok: true, data: { item: row } });
      }

      case 'offer': {
        const body = await parseBody(
          req,
          z.object({
            itemId: uuidSchema,
            offerPrice: z.number().min(0).max(100000).nullable(),
            offerStart: z.string().datetime().nullable(),
            offerEnd: z.string().datetime().nullable(),
          }),
        );
        await setItemOffer(rid, body.itemId, body);
        await auditLog({
          restaurantId: rid,
          actorId: user.user_id,
          actorEmail: user.email,
          action: 'menu.offer.update',
          entity: 'menu_items',
          entityId: body.itemId,
          meta: { offerPrice: body.offerPrice, start: body.offerStart, end: body.offerEnd },
        });
        return NextResponse.json({ ok: true, data: { saved: true } });
      }

      case 'table': {
        const body = await parseBody(req, tableSchema);
        const id = body.id ? (await updateTable(rid, body.id, body), body.id) : await createTable(rid, body);
        await auditLog({
          restaurantId: rid,
          actorId: user.user_id,
          actorEmail: user.email,
          action: body.id ? 'table.update' : 'table.create',
          entity: 'tables',
          entityId: id,
          meta: { number: body.number },
        });
        return NextResponse.json({ ok: true, data: { id } });
      }

      case 'table-delete': {
        const body = await parseBody(req, z.object({ id: uuidSchema }));
        const ok = await deleteTable(rid, body.id);
        return NextResponse.json({ ok: true, data: { deleted: ok } });
      }

      case 'table-regenerate': {
        const body = await parseBody(req, z.object({ id: uuidSchema }));
        const code = await regenerateTableCode(rid, body.id);
        await auditLog({
          restaurantId: rid,
          actorId: user.user_id,
          actorEmail: user.email,
          action: 'table.code.regenerate',
          entity: 'tables',
          entityId: body.id,
        });
        return NextResponse.json({ ok: true, data: { table_code: code } });
      }

      case 'staff': {
        const body = await parseBody(req, staffSchema);
        const id = await createStaffAccount({
          restaurantId: rid,
          email: body.email,
          password: body.password,
          fullName: body.fullName,
          role: body.role,
        });
        await auditLog({
          restaurantId: rid,
          actorId: user.user_id,
          actorEmail: user.email,
          action: 'staff.create',
          entity: 'staff_profiles',
          entityId: id,
          meta: { email: body.email, role: body.role },
        });
        return NextResponse.json({ ok: true, data: { id } });
      }

      case 'staff-update': {
        const body = await parseBody(req, staffUpdateSchema);

        // Your own password changes through "Change password" (it asks for the current one),
        // so a hijacked admin session cannot silently take over the login. Checked first,
        // so a refused request changes nothing.
        if (body.password && body.id === user.id) {
          return jsonError('Use “Change password” to change your own password.', 400);
        }

        if (body.role || body.isActive !== undefined) {
          // never lock yourself out
          const target = await db.one<{ role: string; is_active: boolean }>(
            `select role, is_active from staff_profiles where id = $1 and restaurant_id = $2`,
            [body.id, rid],
          );
          if (!target) return jsonError('Staff member not found.', 404);
          // Both ways of losing the last admin must be caught. The old form used a
          // ternary, so sending `{role:'admin', isActive:false}` (the shape the UI
          // posts when it only flips the switch) skipped the isActive branch and
          // deactivated the only admin — locking the owner out of the panel.
          const losingAdmin =
            target.role === 'admin' &&
            ((body.role !== undefined && body.role !== 'admin') || body.isActive === false);
          if (losingAdmin && (await countActiveAdmins(rid)) <= 1) {
            return jsonError('At least one active admin must remain.', 409);
          }
        }

        if (body.fullName) {
          await db.query(`update staff_profiles set full_name = $3 where id = $1 and restaurant_id = $2`, [
            body.id,
            rid,
            body.fullName,
          ]);
        }
        if (body.role) await setStaffRole(rid, body.id, body.role);
        if (body.isActive !== undefined) await setStaffActive(rid, body.id, body.isActive);
        if (body.password) await resetStaffPassword(body.id, rid, body.password);

        await auditLog({
          restaurantId: rid,
          actorId: user.user_id,
          actorEmail: user.email,
          action: 'staff.update',
          entity: 'staff_profiles',
          entityId: body.id,
          meta: { role: body.role, isActive: body.isActive, passwordReset: Boolean(body.password) },
        });
        return NextResponse.json({ ok: true, data: { updated: true } });
      }

      /** A waiter / kitchen password-change request: approve applies it, reject discards it. */
      case 'password-request-approve':
      case 'password-request-reject': {
        const body = await parseBody(req, passwordDecisionSchema);
        const approve = action === 'password-request-approve';
        const result = await decidePasswordRequest({
          restaurantId: rid,
          requestId: body.id,
          approve,
          note: body.note,
          admin: { id: user.id, user_id: user.user_id, email: user.email },
        });
        return NextResponse.json({ ok: true, data: result });
      }

      case 'staff-delete': {
        const body = await parseBody(req, z.object({ id: uuidSchema }));
        const ok = await deleteStaffAccount(body.id, rid);
        await auditLog({
          restaurantId: rid,
          actorId: user.user_id,
          actorEmail: user.email,
          action: 'staff.delete',
          entity: 'staff_profiles',
          entityId: body.id,
        });
        return NextResponse.json({ ok: true, data: { deleted: ok } });
      }

      /** G2 — "New party" (POST parity with GET; the waiter board uses /api/waiter). */
      case 'new-party': {
        const body = await parseBody(req, newPartySchema);
        const table = await db.one<{ id: string }>(
          `select id from tables where id = $1 and restaurant_id = $2`,
          [body.tableId, rid],
        );
        if (!table) return jsonError('Table not found.', 404);
        const result = await startNewParty(rid, body.tableId, {
          id: user.user_id,
          email: user.email,
        });
        return NextResponse.json({ ok: true, data: result });
      }

      /** J3 — panic button (POST, guarded by an explicit body flag). */
      case 'end-all-sessions': {
        const body = await parseBody(req, z.object({ confirm: z.literal('END') }));
        void body;
        const result = await endAllSessions(rid, { id: user.user_id, email: user.email });
        return NextResponse.json({ ok: true, data: result });
      }

      /** Admin can dismiss / regenerate a code exactly like a waiter (E12). */
      case 'otp-dismiss': {
        const body = await parseBody(req, otpDismissSchema);
        const result = await dismissOtp({
          restaurantId: rid,
          otpId: body.otpId,
          staffUserId: user.user_id,
          staffEmail: user.email,
          reason: body.reason,
        });
        if (!result.dismissed) return jsonError('That code is already closed.', 404);
        return NextResponse.json({ ok: true, data: result });
      }

      case 'otp-raise': {
        const body = await parseBody(req, otpRaiseSchema);
        const table = await db.one<{ id: string; number: number; label: string | null }>(
          `select id, number, label from tables where id = $1 and restaurant_id = $2 and is_active`,
          [body.tableId, rid],
        );
        if (!table) return jsonError('Table not found.', 404);
        const otp = await raiseOtp({
          restaurantId: rid,
          tableId: table.id,
          tableNumber: table.number,
          tableLabel: table.label,
          force: true,
          actor: { id: user.user_id, email: user.email },
        });
        return NextResponse.json({ ok: true, data: { otp } });
      }

      case 'settings': {
        const body = await parseBody(req, settingsSchema);
        await updateRestaurant(rid, {
          name: body.name,
          logo_url: body.logoUrl,
          accent_color: body.accentColor,
          wifi_ssid: body.wifiSsid,
          wifi_password: body.wifiPassword,
          google_review_url: body.googleReviewUrl,
          instagram_url: body.instagramUrl,
          facebook_url: body.facebookUrl,
          website_url: body.websiteUrl,
          phone: body.phone,
          address: body.address,
          tax_percent: body.taxPercent,
          service_charge_percent: body.serviceChargePercent,
        });

        if (body.sounds) {
          const { setSetting } = await import('@/server/repos/service');
          await setSetting(rid, 'sounds', body.sounds);
        }
        if (body.games) {
          const { setSetting } = await import('@/server/repos/service');
          const current = await getSettings(rid);
          await setSetting(rid, 'games', { ...(current.games ?? {}), ...body.games });
        }
        if (body.otp) {
          // Column-level settings (not the key/value table) so the constraints in
          // migration 0006 enforce the ranges, and so a live read is one row.
          const map: Record<string, unknown> = {
            otp_length: body.otp.length,
            otp_window_minutes: body.otp.windowMinutes,
            otp_max_attempts: body.otp.maxAttempts,
            otp_reissue_cooldown_seconds: body.otp.cooldownSeconds,
            max_devices_per_session: body.otp.maxDevices,
            session_idle_minutes: body.otp.idleMinutes,
            session_max_hours: body.otp.maxHours,
            auto_confirm_orders: body.otp.autoConfirmOrders,
            menu_preview_before_code: body.otp.menuPreview,
          };
          const entries = Object.entries(map).filter(([, v]) => v !== undefined);
          if (entries.length > 0) {
            const sets = entries.map(([col], i) => `${col} = $${i + 2}`).join(', ');
            await db.query(
              `update restaurants set ${sets}, updated_at = now() where id = $1`,
              [rid, ...entries.map(([, v]) => v)],
            );
          }
        }

        await auditLog({
          restaurantId: rid,
          actorId: user.user_id,
          actorEmail: user.email,
          action: 'settings.update',
          entity: 'restaurants',
          entityId: rid,
          meta: { fields: Object.keys(body) },
        });
        return NextResponse.json({ ok: true, data: { saved: true } });
      }

      case 'feedback-status': {
        const body = await parseBody(
          req,
          z.object({ id: uuidSchema, status: z.enum(['new', 'read', 'resolved']) }),
        );
        await updateFeedbackStatus(rid, body.id, body.status);
        return NextResponse.json({ ok: true, data: { saved: true } });
      }

      case 'quiz-category': {
        const body = await parseBody(req, quizCategorySchema);
        const id = await saveQuizCategory(rid, body);
        return NextResponse.json({ ok: true, data: { id } });
      }

      case 'quiz-question': {
        const body = await parseBody(req, quizQuestionSchema);
        const id = await saveQuizQuestion(rid, body);
        return NextResponse.json({ ok: true, data: { id } });
      }

      case 'quiz-question-delete': {
        const body = await parseBody(req, z.object({ id: uuidSchema }));
        await deleteQuizQuestion(rid, body.id);
        return NextResponse.json({ ok: true, data: { deleted: true } });
      }

      case 'quiz-import': {
        const body = await parseBody(req, bulkQuestionsSchema);
        const result = await importQuestions(rid, body.categoryId, body.csv);
        await auditLog({
          restaurantId: rid,
          actorId: user.user_id,
          actorEmail: user.email,
          action: 'quiz.import',
          entity: 'quiz_questions',
          meta: { inserted: result.inserted, errors: result.errors.length },
        });
        return NextResponse.json({ ok: true, data: result });
      }

      // ---- the whole-restaurant game: the admin only presses Start, the rest runs by itself
      case 'restaurant-game-start': {
        const started = await startRestaurantGame(rid);
        await auditLog({
          restaurantId: rid,
          actorId: user.user_id,
          actorEmail: user.email,
          action: 'restaurant_game.start',
          entity: 'game_rounds',
          meta: { roundId: started.roundId },
        });
        return NextResponse.json({ ok: true, data: started });
      }

      case 'restaurant-game-cancel': {
        const out = await cancelRestaurantGame(rid);
        await auditLog({
          restaurantId: rid,
          actorId: user.user_id,
          actorEmail: user.email,
          action: 'restaurant_game.cancel',
          entity: 'game_rounds',
        });
        return NextResponse.json({ ok: true, data: out });
      }

      case 'restaurant-game-prize': {
        const body = await parseBody(
          req,
          z.object({ roundId: z.string().uuid(), tableId: z.string().uuid(), given: z.boolean() }),
        );
        await setPrizeGiven({ restaurantId: rid, ...body });
        await auditLog({
          restaurantId: rid,
          actorId: user.user_id,
          actorEmail: user.email,
          action: body.given ? 'restaurant_game.prize_given' : 'restaurant_game.prize_unmarked',
          entity: 'game_scores',
          meta: { roundId: body.roundId },
        });
        return NextResponse.json({ ok: true, data: { saved: true } });
      }

      case 'prize': {
        const body = await parseBody(req, prizeSchema);
        await savePrize(rid, body);
        await auditLog({
          restaurantId: rid,
          actorId: user.user_id,
          actorEmail: user.email,
          action: 'prize.save',
          entity: 'prizes',
          meta: { rank: body.rank },
        });
        return NextResponse.json({ ok: true, data: { saved: true } });
      }

      case 'prize-delete': {
        const body = await parseBody(req, z.object({ rank: z.number().int().min(1).max(20) }));
        await deletePrize(rid, body.rank);
        return NextResponse.json({ ok: true, data: { deleted: true } });
      }

      default:
        return jsonError('Unknown action', 404);
    }
  } catch (err) {
    return handleApiError(err);
  }
}
