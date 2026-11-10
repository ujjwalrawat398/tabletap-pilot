import 'server-only';
import { db } from '@/server/db';

export async function listStaff(restaurantId: string) {
  return db.query<any>(
    `select p.id, p.email, p.full_name, p.role, p.is_active, p.created_at,
            null::timestamptz as last_login_at
       from staff_profiles p
      where p.restaurant_id = $1
      order by p.is_active desc, p.role, p.full_name`,
    [restaurantId],
  );
}

export async function setStaffActive(restaurantId: string, profileId: string, isActive: boolean) {
  const row = await db.one<{ role: string }>(
    `update staff_profiles set is_active = $3
      where id = $1 and restaurant_id = $2 returning role`,
    [profileId, restaurantId, isActive],
  );
  return row;
}

export async function setStaffRole(restaurantId: string, profileId: string, role: string) {
  const row = await db.one(
    `update staff_profiles set role = $3 where id = $1 and restaurant_id = $2 returning id`,
    [profileId, restaurantId, role],
  );
  return Boolean(row);
}

export async function countActiveAdmins(restaurantId: string) {
  const row = await db.one<{ c: number }>(
    `select count(*)::int as c from staff_profiles
      where restaurant_id = $1 and role = 'admin' and is_active`,
    [restaurantId],
  );
  return row?.c ?? 0;
}
