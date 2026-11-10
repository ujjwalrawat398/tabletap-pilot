import 'server-only';
import { db } from '@/server/db';
import type { MenuItemInput } from '@/lib/validation';
import { sanitizeText } from '@/lib/sanitize';

export type PublicMenuItem = {
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

export type PublicCategory = {
  id: string;
  name: string;
  description: string | null;
  emoji: string | null;
  sort_order: number;
  items: PublicMenuItem[];
};

const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

/** Customer-facing menu. Sold-out items are included (greyed out client-side). */
export async function getMenu(restaurantId: string): Promise<PublicCategory[]> {
  const [categories, items] = await Promise.all([
    db.query<any>(
      `select id, name, description, emoji, sort_order
         from menu_categories
        where restaurant_id = $1 and is_active
        order by sort_order, name`,
      [restaurantId],
    ),
    db.query<any>(
      `select id, category_id, name, description, price, offer_price, effective_price,
              offer_active, is_available, is_veg, image_url, spice_level, sort_order
         from menu_items_public
        where restaurant_id = $1
        order by sort_order, name`,
      [restaurantId],
    ),
  ]);

  const byCategory = new Map<string, PublicMenuItem[]>();
  for (const raw of items) {
    const item: PublicMenuItem = {
      id: raw.id,
      category_id: raw.category_id,
      name: raw.name,
      description: raw.description,
      price: num(raw.price),
      offer_price: raw.offer_price === null ? null : num(raw.offer_price),
      effective_price: num(raw.effective_price),
      offer_active: Boolean(raw.offer_active),
      is_available: raw.is_available,
      is_veg: raw.is_veg,
      image_url: raw.image_url,
      spice_level: raw.spice_level,
      sort_order: raw.sort_order,
    };
    const list = byCategory.get(item.category_id) ?? [];
    list.push(item);
    byCategory.set(item.category_id, list);
  }

  return categories
    .map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      emoji: c.emoji,
      sort_order: c.sort_order,
      items: byCategory.get(c.id) ?? [],
    }))
    .filter((c) => c.items.length > 0);
}

/** Admin view: includes inactive categories/items and both prices. */
export async function getAdminMenu(restaurantId: string) {
  const [categories, items] = await Promise.all([
    db.query<any>(
      `select * from menu_categories where restaurant_id = $1 order by sort_order, name`,
      [restaurantId],
    ),
    db.query<any>(
      `select i.*, effective_price(i.price, i.offer_price, i.offer_start, i.offer_end) as effective_price
         from menu_items i where i.restaurant_id = $1 order by i.sort_order, i.name`,
      [restaurantId],
    ),
  ]);
  return { categories, items };
}

export async function saveCategory(
  restaurantId: string,
  input: { id?: string; name: string; description?: string | null; emoji?: string | null; sortOrder: number; isActive: boolean },
) {
  const name = sanitizeText(input.name, 80);
  const description = input.description ? sanitizeText(input.description, 200) : null;
  if (input.id) {
    await db.query(
      `update menu_categories
          set name=$2, description=$3, emoji=$4, sort_order=$5, is_active=$6
        where id=$1 and restaurant_id=$7`,
      [input.id, name, description, input.emoji ?? null, input.sortOrder, input.isActive, restaurantId],
    );
    return input.id;
  }
  const row = await db.one<{ id: string }>(
    `insert into menu_categories (restaurant_id, name, description, emoji, sort_order, is_active)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [restaurantId, name, description, input.emoji ?? null, input.sortOrder, input.isActive],
  );
  return row!.id;
}

export async function deleteCategory(restaurantId: string, id: string) {
  const row = await db.one(
    `delete from menu_categories where id = $1 and restaurant_id = $2 returning id`,
    [id, restaurantId],
  );
  return Boolean(row);
}

export async function saveMenuItem(restaurantId: string, input: MenuItemInput) {
  const name = sanitizeText(input.name, 120);
  const description = input.description ? sanitizeText(input.description, 400) : null;
  const values = [
    input.categoryId,
    name,
    description,
    input.price,
    input.offerPrice ?? null,
    input.offerStart ?? null,
    input.offerEnd ?? null,
    input.isAvailable,
    input.isVeg,
    input.imageUrl ?? null,
    input.spiceLevel,
    input.prepMinutes,
    input.sortOrder,
  ];

  if (input.id) {
    await db.query(
      `update menu_items set
         category_id=$2, name=$3, description=$4, price=$5, offer_price=$6, offer_start=$7,
         offer_end=$8, is_available=$9, is_veg=$10, image_url=$11, spice_level=$12,
         prep_minutes=$13, sort_order=$14
       where id=$1 and restaurant_id=$15`,
      [input.id, ...values, restaurantId],
    );
    return input.id;
  }
  const row = await db.one<{ id: string }>(
    `insert into menu_items (restaurant_id, category_id, name, description, price, offer_price,
       offer_start, offer_end, is_available, is_veg, image_url, spice_level, prep_minutes, sort_order)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning id`,
    [restaurantId, ...values],
  );
  return row!.id;
}

export async function deleteMenuItem(restaurantId: string, id: string) {
  // soft delete: keep sold-out history intact, just hide the item
  const row = await db.one(
    `update menu_items set is_available = false where id = $1 and restaurant_id = $2 returning id`,
    [id, restaurantId],
  );
  return Boolean(row);
}

export async function setItemAvailability(restaurantId: string, itemId: string, isAvailable: boolean) {
  const row = await db.one<{ name: string; price: number }>(
    `update menu_items set is_available = $3
      where id = $1 and restaurant_id = $2 returning name, price`,
    [itemId, restaurantId, isAvailable],
  );
  return row;
}

/** Happy-hour style offer window on a single item. */
export async function setItemOffer(
  restaurantId: string,
  itemId: string,
  offer: { offerPrice: number | null; offerStart: string | null; offerEnd: string | null },
) {
  const row = await db.one(
    `update menu_items
        set offer_price = $3, offer_start = $4, offer_end = $5
      where id = $1 and restaurant_id = $2 returning id`,
    [itemId, restaurantId, offer.offerPrice, offer.offerStart, offer.offerEnd],
  );
  return Boolean(row);
}

export async function getMenuItemForSession(restaurantId: string, itemId: string) {
  return db.one<any>(
    `select * from menu_items_public where id = $1 and restaurant_id = $2`,
    [itemId, restaurantId],
  );
}
