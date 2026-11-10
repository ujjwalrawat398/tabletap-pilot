-- =====================================================================
-- TableTap — seed data
-- Demo restaurant "Spice Route", 10 tables, menu, 30+ quiz questions
-- across 4 categories, prizes, settings.
-- Passwords are NOT stored here — supabase/seed/README.md explains how to
-- create the three demo staff logins (admin / waiter / kitchen).
-- =====================================================================

-- Deterministic-ish ids so re-seeding is easy to reason about.
delete from restaurants where slug = 'spice-route';

insert into restaurants (
  id, name, slug, accent_color, currency, timezone, phone, address,
  wifi_ssid, wifi_password, google_review_url, instagram_url,
  tax_percent, service_charge_percent
) values (
  '11111111-1111-4111-8111-111111111111',
  'Spice Route Kitchen', 'spice-route', '#e85d2a', 'INR', 'Asia/Kolkata',
  '+91 98765 43210', '12 Fatehabad Road, Tajganj, Agra 282001',
  'SpiceRoute_Guest', 'masala2026',
  'https://search.google.com/local/writereview?placeid=REPLACE_WITH_YOUR_PLACE_ID',
  'https://instagram.com/spiceroute', 5.00, 0.00
);

-- ---------- tables --------------------------------------------------
insert into tables (restaurant_id, number, label, seats, zone, table_code)
select '11111111-1111-4111-8111-111111111111',
       n, 'Table ' || n, case when n <= 6 then 4 else 6 end,
       case when n <= 6 then 'Indoor' else 'Terrace' end,
       substr(md5(random()::text || n::text || clock_timestamp()::text), 1, 24)
from generate_series(1, 10) as n;

-- ---------- menu ----------------------------------------------------
insert into menu_categories (id, restaurant_id, name, description, emoji, sort_order) values
 ('22222222-2222-4222-8222-000000000001','11111111-1111-4111-8111-111111111111','Starters','Crisp, hot, shareable','🥗',1),
 ('22222222-2222-4222-8222-000000000002','11111111-1111-4111-8111-111111111111','Tandoor','Charred in the clay oven','🔥',2),
 ('22222222-2222-4222-8222-000000000003','11111111-1111-4111-8111-111111111111','Main Course','Curries and biryanis','🍛',3),
 ('22222222-2222-4222-8222-000000000004','11111111-1111-4111-8111-111111111111','Breads & Rice','Fresh from the tandoor','🫓',4),
 ('22222222-2222-4222-8222-000000000005','11111111-1111-4111-8111-111111111111','Drinks','Coolers and chai','🥤',5),
 ('22222222-2222-4222-8222-000000000006','11111111-1111-4111-8111-111111111111','Desserts','Something sweet','🍮',6);

insert into menu_items
 (restaurant_id, category_id, name, description, price, offer_price, offer_start, offer_end,
  is_available, is_veg, spice_level, prep_minutes, sort_order)
values
 -- Starters
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000001','Paneer Tikka','Cottage cheese cubes marinated in yoghurt and spices',280,240,now()-interval'1 day',now()+interval'30 day',true,true,1,15,1),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000001','Chicken Malai Tikka','Creamy chicken skewers, mildly spiced',340,null,null,null,true,false,1,18,2),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000001','Veg Spring Rolls','Six crisp rolls with sweet chilli dip',210,null,null,null,true,true,0,12,3),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000001','Chilli Paneer','Indo-Chinese, hot and tangy',290,260,now()-interval'1 day',now()+interval'7 day',true,true,2,15,4),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000001','Mushroom Galouti','Mushroom patties with roomali roti',260,null,null,null,false,true,1,14,5),
 -- Tandoor
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000002','Tandoori Chicken (Half)','Overnight marinade, charcoal grilled',420,null,null,null,true,false,2,25,1),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000002','Seekh Kebab','Minced mutton kebab with mint chutney',380,340,now()-interval'2 hour',now()+interval'5 day',true,false,2,22,2),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000002','Tandoori Aloo','Stuffed baby potatoes',240,null,null,null,true,true,1,18,3),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000002','Malai Broccoli','Cheese and cream broccoli florets',320,290,now()-interval'1 day',now()+interval'10 day',true,true,0,16,4),
 -- Mains
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000003','Butter Chicken','House special, tomato and butter gravy',420,380,now()-interval'1 day',now()+interval'30 day',true,false,1,20,1),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000003','Dal Makhani','Slow cooked overnight with white butter',280,null,null,null,true,true,1,15,2),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000003','Paneer Butter Masala','Paneer in silky makhani gravy',340,null,null,null,true,true,1,18,3),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000003','Mutton Rogan Josh','Kashmiri style, aromatic and rich',480,440,now()-interval'1 day',now()+interval'20 day',true,false,2,30,4),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000003','Hyderabadi Chicken Biryani','Dum biryani with mirchi ka salan',390,null,null,null,true,false,2,25,5),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000003','Veg Dum Biryani','Seasonal vegetables, saffron rice',320,null,null,null,true,true,1,25,6),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000003','Kadai Mushroom','Mushroom and capsicum, dry masala',300,null,null,null,false,true,2,18,7),
 -- Breads & Rice
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000004','Butter Naan',null,60,null,null,null,true,true,0,8,1),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000004','Garlic Naan',null,80,null,null,null,true,true,0,8,2),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000004','Laccha Paratha',null,70,null,null,null,true,true,0,9,3),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000004','Jeera Rice',null,180,null,null,null,true,true,0,12,4),
 -- Drinks
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000005','Masala Chai',null,60,null,null,null,true,true,0,6,1),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000005','Sweet Lassi',null,110,90,now()-interval'1 day',now()+interval'15 day',true,true,0,5,2),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000005','Fresh Lime Soda',null,90,null,null,null,true,true,0,4,3),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000005','Cold Coffee',null,140,null,null,null,true,true,0,6,4),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000005','Mineral Water',null,30,null,null,null,true,true,0,1,5),
 -- Desserts
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000006','Gulab Jamun (2 pc)',null,120,null,null,null,true,true,0,5,1),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000006','Gajar Halwa','Seasonal, served warm',160,null,null,null,true,true,0,5,2),
 ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-000000000006','Kulfi Falooda',null,180,160,now()-interval'1 day',now()+interval'60 day',true,true,0,6,3);

-- ---------- quiz categories + questions -----------------------------
insert into quiz_categories (id, restaurant_id, name, slug, emoji, sort_order) values
 ('33333333-3333-4333-8333-000000000001','11111111-1111-4111-8111-111111111111','Science','science','🔬',1),
 ('33333333-3333-4333-8333-000000000002','11111111-1111-4111-8111-111111111111','General Knowledge','gk','🌍',2),
 ('33333333-3333-4333-8333-000000000003','11111111-1111-4111-8111-111111111111','Maths','maths','➗',3),
 ('33333333-3333-4333-8333-000000000004','11111111-1111-4111-8111-111111111111','India & Food','india-food','🇮🇳',4);

insert into quiz_questions (restaurant_id, category_id, question, options, correct_index, explanation, difficulty) values
-- Science (10)
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000001','Which planet is known as the Red Planet?','["Venus","Mars","Jupiter","Mercury"]',1,'Iron oxide (rust) on its surface gives Mars its red colour.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000001','What gas do plants absorb during photosynthesis?','["Oxygen","Nitrogen","Carbon dioxide","Hydrogen"]',2,'Plants take in CO2 and release oxygen using sunlight.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000001','The chemical symbol Fe stands for which element?','["Fluorine","Iron","Francium","Fermium"]',1,'Fe comes from the Latin word ferrum, meaning iron.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000001','How many bones are in the adult human body?','["186","206","226","246"]',1,'Adults have 206 bones; babies start with about 270 that fuse.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000001','What is the speed of light in a vacuum?','["3,00,000 m/s","3,00,000 km/s","30,000 km/s","3,000 km/s"]',1,'Light travels about 3 lakh kilometres per second.',2),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000001','Which part of the cell is called the powerhouse?','["Nucleus","Ribosome","Mitochondria","Golgi body"]',2,'Mitochondria generate ATP, the cell''s energy currency.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000001','Water boils at what temperature at sea level?','["90 °C","95 °C","100 °C","110 °C"]',2,'At standard atmospheric pressure water boils at 100 °C.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000001','Which vitamin is produced when skin is exposed to sunlight?','["Vitamin A","Vitamin B12","Vitamin C","Vitamin D"]',3,'UV-B helps the skin synthesise vitamin D.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000001','What is the hardest naturally occurring substance?','["Quartz","Diamond","Titanium","Corundum"]',1,'Diamond scores 10 on the Mohs hardness scale.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000001','Sound cannot travel through which medium?','["Water","Steel","Air","Vacuum"]',3,'Sound needs a medium; a vacuum has no particles to vibrate.',1),
-- GK (10)
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000002','Which is the largest ocean on Earth?','["Atlantic","Indian","Arctic","Pacific"]',3,'The Pacific covers about one third of the planet.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000002','How many countries share a border with India by land?','["5","6","7","8"]',2,'India shares land borders with 7 countries.',2),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000002','The Taj Mahal is located in which city?','["Jaipur","Agra","Delhi","Lucknow"]',1,'It stands on the bank of the Yamuna in Agra.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000002','Which organisation publishes the Human Development Index?','["World Bank","UNESCO","UNDP","WHO"]',2,'The UNDP publishes the HDI every year.',2),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000002','Who wrote the Indian national anthem?','["Bankim Chandra Chatterjee","Rabindranath Tagore","Sarojini Naidu","Subramania Bharati"]',1,'Tagore wrote Jana Gana Mana; Bankim Chandra wrote Vande Mataram.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000002','Which currency is used in Japan?','["Won","Yuan","Yen","Ringgit"]',2,'Japan uses the yen (¥).',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000002','The Amazon rainforest is mostly in which country?','["Peru","Brazil","Colombia","Venezuela"]',1,'About 60% of the Amazon lies in Brazil.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000002','Which sport uses the term "Silly Point"?','["Hockey","Cricket","Badminton","Tennis"]',1,'Silly point is a close-catching position in cricket.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000002','Which is the longest river in India?','["Yamuna","Godavari","Ganga","Brahmaputra"]',2,'The Ganga runs about 2,525 km within India.',2),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000002','UNESCO headquarters is in which city?','["Geneva","Paris","New York","Vienna"]',1,'UNESCO is headquartered in Paris, France.',2),
-- Maths (10)
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000003','What is 15% of 240?','["24","32","36","42"]',2,'10% is 24, 5% is 12, so 15% is 36.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000003','Which number is a prime?','["51","57","61","63"]',2,'61 has no divisors other than 1 and itself.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000003','The sum of angles in a triangle is…','["90°","180°","270°","360°"]',1,'Every planar triangle adds up to 180 degrees.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000003','What comes next: 2, 6, 12, 20, 30, ?','["36","40","42","48"]',2,'Differences are 4,6,8,10,12 so 30+12 = 42.',2),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000003','A bill of 1200 gets a 25% discount. Final amount?','["800","850","900","950"]',2,'25% of 1200 is 300, so 1200 − 300 = 900.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000003','Square root of 169 is…','["11","12","13","14"]',2,'13 × 13 = 169.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000003','How many seconds are in 45 minutes?','["2400","2600","2700","3000"]',2,'45 × 60 = 2700 seconds.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000003','If 4 cooks make 40 rotis in 20 minutes, 8 cooks need how long?','["5 minutes","10 minutes","15 minutes","20 minutes"]',1,'Double the cooks, half the time: 10 minutes.',2),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000003','What is 7 × 8 − 6 ÷ 2?','["50","53","56","59"]',1,'First 6÷2=3, then 56−3 = 53.',2),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000003','A circle has a radius of 7 cm. Its area is closest to…','["44 cm²","154 cm²","308 cm²","49 cm²"]',1,'πr² = 3.14 × 49 ≈ 154 cm².',3),
-- India & Food (10)
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000004','Biryani is said to have arrived in India with which influence?','["Portuguese","Mughal/Persian","Dutch","Chinese"]',1,'It came through Persian and Mughal kitchens.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000004','Which spice is known as "Indian saffron"?','["Cardamom","Turmeric","Cumin","Clove"]',1,'Turmeric is called Indian saffron because of its colour.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000004','Ghee is clarified from which ingredient?','["Milk","Coconut","Mustard","Palm"]',0,'Ghee is clarified butter made from milk fat.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000004','Which state is famous for Dhokla?','["Punjab","Gujarat","Kerala","Assam"]',1,'Dhokla is a steamed gram-flour snack from Gujarat.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000004','Masala chai traditionally uses which tea base?','["Green tea","Black tea","White tea","Oolong"]',1,'Strong black Assam tea is the classic base.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000004','Rogan Josh originated in which region?','["Kashmir","Goa","Bengal","Tamil Nadu"]',0,'It is a Kashmiri dish, its name from Persian words.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000004','Which lentil is used in dal makhani?','["Toor","Urad (black gram)","Moong","Chana"]',1,'Whole urad dal is slow cooked for dal makhani.',2),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000004','Paan is traditionally wrapped in which leaf?','["Banana","Betel","Mango","Teak"]',1,'Betel leaves hold the paan mixture.',1),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000004','Which city is known as the "City of Nawabs" for its kebabs?','["Lucknow","Hyderabad","Bhopal","Patna"]',0,'Lucknow''s Awadhi cuisine made seekh kebabs famous.',2),
('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-000000000004','What does "tandoor" mean?','["A clay oven","A spice mix","A cooking pot","A flatbread"]',0,'A tandoor is a cylindrical clay or metal oven.',1);

-- ---------- prizes + settings ---------------------------------------
insert into prizes (restaurant_id, rank, title, description) values
 ('11111111-1111-4111-8111-111111111111',1,'Free Dessert','Table at rank 1 wins a free dessert of choice'),
 ('11111111-1111-4111-8111-111111111111',2,'10% off the bill','Applied at the counter for the winning table'),
 ('11111111-1111-4111-8111-111111111111',3,'Free Masala Chai','One chai per player at the table');

insert into settings (restaurant_id, key, value) values
 ('11111111-1111-4111-8111-111111111111','sounds','{"new_order":"chime","waiter_call":"bell","bill_request":"cash","order_ready":"ding"}'),
 ('11111111-1111-4111-8111-111111111111','ordering','{"cart_locked_when_pending":false,"max_qty_per_item":20,"waiter_call_cooldown_seconds":30}'),
 ('11111111-1111-4111-8111-111111111111','games','{"rounds_per_round":10,"restaurant_round_interval_minutes":5,"speed_bonus_max":50,"speed_bonus_window_ms":10000,"points_correct":100,"points_mode":"sum"}'),
 ('11111111-1111-4111-8111-111111111111','i18n','{"default_locale":"en","locales":["en","hi"]}');

-- ---------- a little history so reports are not empty ---------------
-- (12 orders spread over today and yesterday)
insert into table_sessions (restaurant_id, table_id, token_hash, expires_at, closed_at)
select '11111111-1111-4111-8111-111111111111',
       (select id from tables where restaurant_id='11111111-1111-4111-8111-111111111111' and number = 1 + (i % 10)),
       md5('seed-session-'||i),
       now() - interval '1 hour', now() - interval '30 minute'
from generate_series(1,12) i;

-- Simple, readable history generator:
insert into orders (restaurant_id, session_id, table_id, batch_no, status, subtotal, tax, total,
                    confirmed_at, preparing_at, ready_at, created_at)
select '11111111-1111-4111-8111-111111111111', s.id, s.table_id, 1,
       case when s.rn in (3, 9) then 'rejected'::order_status else 'served'::order_status end,
       amt, round(amt * 0.05, 2), round(amt * 1.05, 2),
       s.created_at + interval '2 minute', s.created_at + interval '5 minute',
       s.created_at + interval '14 minute', s.created_at
from (
  select id, table_id, created_at,
         row_number() over (order by id) rn,
         (180 + (row_number() over (order by id) * 61) % 900)::numeric as amt
  from table_sessions
  where restaurant_id = '11111111-1111-4111-8111-111111111111'
    and closed_at is not null
) s;

insert into order_items (restaurant_id, order_id, menu_item_id, name_snapshot, qty, base_price, unit_price, offer_applied)
select o.restaurant_id, o.id, mi.id, mi.name, 2, mi.price, mi.price, false
from orders o
join lateral (select * from menu_items where restaurant_id = o.restaurant_id order by random() limit 2) mi on true;
