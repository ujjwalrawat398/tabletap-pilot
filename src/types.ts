/** Shared client/server view types. */

export type CartLine = {
  id: string;
  menu_item_id: string;
  name: string;
  image_url: string | null;
  is_veg: boolean;
  qty: number;
  notes: string | null;
  added_by_guest: number;
  base_price: number;
  unit_price: number;
  offer_active: boolean;
  is_available: boolean;
  line_total: number;
};

export type Cart = {
  id: string;
  lines: CartLine[];
  subtotal: number;
  itemCount: number;
};

export type OrderStatus =
  | 'pending'
  | 'confirmed'
  | 'rejected'
  | 'preparing'
  | 'ready'
  | 'served'
  | 'cancelled';

export type OrderItemView = {
  id: string;
  name_snapshot: string;
  qty: number;
  unit_price: number;
  base_price: number;
  offer_applied: boolean;
  notes: string | null;
  added_by_guest: number;
};

export type OrderView = {
  id: string;
  batch_no: number;
  status: OrderStatus;
  subtotal: number;
  tax: number;
  service_charge: number;
  total: number;
  notes: string | null;
  table_id: string;
  table_number?: number;
  session_id: string;
  created_at: string;
  confirmed_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  rejected_reason: string | null;
  items: OrderItemView[];
  /** Pending queue only: when the table's visit started, and how many phones joined. */
  session_started_at?: string | null;
  session_devices?: number;
};

export type MenuItem = {
  id: string;
  category_id: string;
  name: string;
  description: string | null;
  price: number;
  offer_price: number | null;
  effective_price: number;
  offer_active: boolean;
  is_available: boolean;
  is_veg: boolean;
  image_url: string | null;
  spice_level: number;
  sort_order: number;
};

export type MenuCategory = {
  id: string;
  name: string;
  description: string | null;
  emoji: string | null;
  sort_order: number;
  items: MenuItem[];
};

export type TableCard = {
  id: string;
  number: number;
  label: string | null;
  zone: string | null;
  seats: number;
  status: 'free' | 'occupied';
  table_code: string;
  session_id: string | null;
  session_expires_at: string | null;
  session_started_at: string | null;
  pending_orders: number;
  open_calls: number;
  bill_requests: number;
  active_orders: number;
  revenue: number;
};

export type StaffUser = {
  id: string;
  user_id: string;
  restaurant_id: string;
  email: string;
  full_name: string;
  role: 'admin' | 'waiter' | 'kitchen';
  restaurant_name: string;
  accent_color: string;
  currency: string;
};

export type WaiterCall = {
  id: string;
  type: 'call' | 'bill';
  status: 'open' | 'handled';
  created_at: string;
  table_id: string;
  session_id: string;
  table_number: number;
};


/**
 * The restaurant game the admin started, as the phones see it (null when none is on).
 * phase: join = open for joining · rules = joining closed, rules on screen · live = match running.
 */
export type RestaurantGameInfo = {
  id: string;
  phase: 'join' | 'rules' | 'live';
  startsAt: string;
  joinClosesAt: string;
  serverNow: string;
  /** this phone is in the game */
  joined: boolean;
  /** this phone quit it and cannot come back */
  left: boolean;
  /** this phone's table already has its two players */
  tableFull: boolean;
  tables: number;
} | null;
