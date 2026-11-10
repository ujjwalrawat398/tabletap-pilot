import 'server-only';
import { db } from '@/server/db';

export type SalesSummary = {
  from: string;
  to: string;
  totalOrders: number;
  totalRevenue: number;
  rejectedOrders: number;
  averageOrderValue: number;
  topItems: { name: string; qty: number; revenue: number }[];
  byHour: { hour: number; orders: number; revenue: number }[];
  byDay: { date: string; orders: number; revenue: number }[];
  byTable: { table_number: number; orders: number; revenue: number }[];
};

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** Daily sales report (spec §9) — date range in the restaurant's timezone. */
export async function getSalesReport(restaurantId: string, from: string, to: string): Promise<SalesSummary> {
  const [totals, items, hours, days, tables] = await Promise.all([
    db.one<any>(
      `select
         count(*) filter (where status <> 'rejected')::int as total_orders,
         coalesce(sum(total) filter (where status <> 'rejected'), 0) as total_revenue,
         count(*) filter (where status = 'rejected')::int as rejected_orders
       from orders
      where restaurant_id = $1
        and (created_at at time zone 'Asia/Kolkata')::date between $2::date and $3::date`,
      [restaurantId, from, to],
    ),
    db.query<any>(
      `select oi.name_snapshot as name, sum(oi.qty)::int as qty,
              sum(oi.qty * oi.unit_price) as revenue
         from order_items oi
         join orders o on o.id = oi.order_id
        where o.restaurant_id = $1 and o.status <> 'rejected'
          and (o.created_at at time zone 'Asia/Kolkata')::date between $2::date and $3::date
        group by 1 order by qty desc limit 10`,
      [restaurantId, from, to],
    ),
    db.query<any>(
      `select extract(hour from (created_at at time zone 'Asia/Kolkata'))::int as hour,
              count(*)::int as orders, coalesce(sum(total),0) as revenue
         from orders
        where restaurant_id = $1 and status <> 'rejected'
          and (created_at at time zone 'Asia/Kolkata')::date between $2::date and $3::date
        group by 1 order by 1`,
      [restaurantId, from, to],
    ),
    db.query<any>(
      `select (created_at at time zone 'Asia/Kolkata')::date::text as date,
              count(*)::int as orders, coalesce(sum(total),0) as revenue
         from orders
        where restaurant_id = $1 and status <> 'rejected'
          and (created_at at time zone 'Asia/Kolkata')::date between $2::date and $3::date
        group by 1 order by 1`,
      [restaurantId, from, to],
    ),
    db.query<any>(
      `select t.number as table_number, count(*)::int as orders, coalesce(sum(o.total),0) as revenue
         from orders o join tables t on t.id = o.table_id
        where o.restaurant_id = $1 and o.status <> 'rejected'
          and (o.created_at at time zone 'Asia/Kolkata')::date between $2::date and $3::date
        group by 1 order by revenue desc limit 15`,
      [restaurantId, from, to],
    ),
  ]);

  const totalOrders = totals?.total_orders ?? 0;
  const totalRevenue = num(totals?.total_revenue);

  return {
    from,
    to,
    totalOrders,
    totalRevenue,
    rejectedOrders: totals?.rejected_orders ?? 0,
    averageOrderValue: totalOrders ? Math.round((totalRevenue / totalOrders) * 100) / 100 : 0,
    topItems: items.map((i) => ({ name: i.name, qty: i.qty, revenue: num(i.revenue) })),
    byHour: hours.map((h) => ({ hour: h.hour, orders: h.orders, revenue: num(h.revenue) })),
    byDay: days.map((d) => ({ date: d.date, orders: d.orders, revenue: num(d.revenue) })),
    byTable: tables.map((t) => ({
      table_number: t.table_number,
      orders: t.orders,
      revenue: num(t.revenue),
    })),
  };
}

export async function getDashboardStats(restaurantId: string) {
  const [row] = await db.query<any>(
    `select
       (select count(*)::int from orders where restaurant_id = $1 and status = 'pending') as pending_orders,
       (select count(*)::int from orders where restaurant_id = $1 and status in ('confirmed','preparing')) as kitchen_orders,
       (select count(*)::int from waiter_calls where restaurant_id = $1 and status = 'open') as open_calls,
       (select count(*)::int from tables where restaurant_id = $1 and is_active and status = 'occupied') as occupied_tables,
       (select count(*)::int from tables where restaurant_id = $1 and is_active) as total_tables,
       (select coalesce(sum(total),0) from orders where restaurant_id = $1
          and status <> 'rejected'
          and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date) as today_revenue,
       (select count(*)::int from orders where restaurant_id = $1
          and (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date) as today_orders,
       (select count(*)::int from feedback where restaurant_id = $1 and status = 'new') as new_feedback,
       (select round(avg(rating),1) from reviews where restaurant_id = $1) as avg_rating`,
    [restaurantId],
  );
  return {
    pendingOrders: row?.pending_orders ?? 0,
    kitchenOrders: row?.kitchen_orders ?? 0,
    openCalls: row?.open_calls ?? 0,
    occupiedTables: row?.occupied_tables ?? 0,
    totalTables: row?.total_tables ?? 0,
    todayRevenue: num(row?.today_revenue),
    todayOrders: row?.today_orders ?? 0,
    newFeedback: row?.new_feedback ?? 0,
    avgRating: row?.avg_rating === null ? null : num(row?.avg_rating),
  };
}

export async function getAuditLog(restaurantId: string, limit = 100) {
  return db.query<any>(
    `select * from audit_log where restaurant_id = $1 order by created_at desc limit $2`,
    [restaurantId, limit],
  );
}
