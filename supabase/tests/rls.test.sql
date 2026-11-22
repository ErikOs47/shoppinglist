-- RLS- und Integritätstests. Ausführen: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(46);

-- Testnutzer: A und B bilden einen Haushalt, C ist fremd, D will als Dritter beitreten.
insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-00000000000a', 'a@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000b', 'b@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000c', 'c@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-00000000000d', 'd@test.local', 'authenticated', 'authenticated');

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

-- --- Haushalt anlegen und beitreten --------------------------------------
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ select public.create_household('WG A') $$, 'A legt Haushalt an');
select throws_ok($$ select public.create_household('Zweiter') $$, 'P0001', null, 'A kann keinen zweiten Haushalt anlegen');
select is((select count(*)::int from public.households), 1, 'A sieht genau einen Haushalt');
select matches((select invite_code from public.households), '^[A-HJ-NP-Z2-9]{12}$', 'Einladungscode hat 12 gut lesbare Zeichen');

-- Code für die nächsten Schritte merken (als postgres, damit B ihn "kennt")
reset role;
create temp table code as select invite_code as c, id from public.households
  where created_by = '00000000-0000-0000-0000-00000000000a';
grant select on code to authenticated;

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select throws_ok($$ select public.join_household('FALSCHCODE00') $$, 'P0001', 'Einladungscode ungültig', 'Falscher Code wird abgelehnt');
select lives_ok($$ select public.join_household(lower((select c from code))) $$, 'B tritt mit Code bei (Kleinschreibung egal)');
select is((select count(*)::int from public.household_members), 2, 'B sieht beide Mitglieder');

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select lives_ok($$ select public.create_household('Fremd C') $$, 'C legt eigenen Haushalt an');

select pg_temp.login('00000000-0000-0000-0000-00000000000d');
select throws_ok($$ select public.join_household((select c from code)) $$, 'P0001', 'Haushalt hat bereits zwei Mitglieder', 'Dritter kann nicht beitreten');

-- --- Produkte -------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select lives_ok($$ insert into public.products (id, household_id, name, category)
  values ('10000000-0000-0000-0000-000000000001', public.my_household_id(), 'Milch', 'Milchprodukte & Eier') $$,
  'A legt Produkt an');
select throws_ok($$ insert into public.products (id, household_id, name, category)
  values ('10000000-0000-0000-0000-000000000002', public.my_household_id(), 'MILCH', 'Sonstiges') $$,
  '23505', null, 'Duplikat (andere Schreibweise) wird abgelehnt');
select throws_ok($$ insert into public.products (id, household_id, name, category)
  values ('10000000-0000-0000-0000-000000000003', public.my_household_id(), ' Brot', 'Sonstiges') $$,
  '23514', null, 'Ungetrimmter Name wird abgelehnt');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
select is((select name from public.products where id = '10000000-0000-0000-0000-000000000001'), 'Milch', 'B sieht Produkt von A');

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.products), 0, 'C sieht keine fremden Produkte');
select throws_ok($$ insert into public.products (id, household_id, name, category)
  values ('10000000-0000-0000-0000-000000000004', (select id from code), 'Hack', 'Sonstiges') $$,
  '42501', null, 'C kann nicht in fremden Haushalt schreiben');
update public.products set name = 'Gehackt' where id = '10000000-0000-0000-0000-000000000001';
delete from public.products where id = '10000000-0000-0000-0000-000000000001';
select is((select count(*)::int from public.households), 1, 'C sieht nur den eigenen Haushalt');
-- Ein Produkt mit gleichem Namen in einem anderen Haushalt ist erlaubt
select lives_ok($$ insert into public.products (id, household_id, name, category)
  values ('10000000-0000-0000-0000-000000000005', public.my_household_id(), 'Milch', 'Sonstiges') $$,
  'Gleicher Name in anderem Haushalt ist erlaubt');

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is((select name from public.products where id = '10000000-0000-0000-0000-000000000001'), 'Milch',
  'Update/Delete von C hatte keine Wirkung');

-- --- Einkaufszettel -------------------------------------------------------
select lives_ok($$ insert into public.list_items (id, household_id, product_id)
  values ('20000000-0000-0000-0000-000000000001', public.my_household_id(), '10000000-0000-0000-0000-000000000001') $$,
  'A setzt Milch auf den Zettel');
select throws_ok($$ insert into public.list_items (id, household_id, product_id)
  values ('20000000-0000-0000-0000-000000000002', public.my_household_id(), '10000000-0000-0000-0000-000000000001') $$,
  '23505', null, 'Produkt kann nicht doppelt auf dem Zettel stehen');
select throws_ok($$ insert into public.list_items (id, household_id, product_id)
  values ('20000000-0000-0000-0000-000000000003', public.my_household_id(), '10000000-0000-0000-0000-000000000005') $$,
  '23503', null, 'Fremdes Produkt kann nicht auf den eigenen Zettel');

select pg_temp.login('00000000-0000-0000-0000-00000000000b');
update public.list_items set checked = true where product_id = '10000000-0000-0000-0000-000000000001';
select is((select checked from public.list_items where product_id = '10000000-0000-0000-0000-000000000001'), true, 'B hakt ab');

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is((select count(*)::int from public.list_items), 0, 'C sieht fremden Zettel nicht');

-- Einkauf abschließen: nur abgehakte Einträge weg, Produkt bleibt
select pg_temp.login('00000000-0000-0000-0000-00000000000a');
insert into public.products (id, household_id, name, category)
  values ('10000000-0000-0000-0000-000000000006', public.my_household_id(), 'Brot', 'Brot & Backwaren');
insert into public.list_items (id, household_id, product_id)
  values ('20000000-0000-0000-0000-000000000006', public.my_household_id(), '10000000-0000-0000-0000-000000000006');
delete from public.list_items
  where product_id in ('10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006') and checked;
select is((select array_agg(product_id)::text from public.list_items), '{10000000-0000-0000-0000-000000000006}',
  'Abschluss entfernt nur abgehakte Artikel');
select is((select count(*)::int from public.products where household_id = public.my_household_id()), 2,
  'Produktdatenbank bleibt beim Abschluss unverändert');

-- Favoriten, Reihenfolge, Kaufhistorie (Migration 20261122100000)
insert into public.list_items (id, household_id, product_id, checked, position)
  values ('20000000-0000-0000-0000-000000000007', public.my_household_id(), '10000000-0000-0000-0000-000000000001', true, 5);
update public.products set favorite = true where id = '10000000-0000-0000-0000-000000000001';
select is((select favorite from public.products where id = '10000000-0000-0000-0000-000000000001'), true, 'Favorit setzbar');
update public.list_items set position = 0.5 where product_id = '10000000-0000-0000-0000-000000000006';
select is((select position from public.list_items where product_id = '10000000-0000-0000-0000-000000000006'), 0.5::float8, 'Reihenfolge setzbar');
select is(public.finish_shopping(array['10000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000006']::uuid[]), 1,
  'finish_shopping entfernt nur Abgehaktes');
select is((select array_agg(purchase_count order by name)::text from public.products where household_id = public.my_household_id()),
  '{0,1}', 'Nur gekaufte Artikel werden gezählt (Brot 0, Milch 1)');
select isnt((select last_purchased_at from public.products where id = '10000000-0000-0000-0000-000000000001'), null,
  'Kaufzeitpunkt gesetzt');
select is(public.finish_shopping(array['10000000-0000-0000-0000-000000000001']::uuid[]), 0,
  'Wiederholung zählt nicht doppelt');

select pg_temp.login('00000000-0000-0000-0000-00000000000c');
select is(public.finish_shopping(array['10000000-0000-0000-0000-000000000006']::uuid[]), 0,
  'Fremder Haushalt kann nichts abschließen');

select pg_temp.login('00000000-0000-0000-0000-00000000000a');
select is((select purchase_count from public.products where id = '10000000-0000-0000-0000-000000000001'), 1,
  'Zähler nach Wiederholung und Fremdzugriff unverändert');
select ok(not has_function_privilege('anon', 'public.finish_shopping(uuid[])', 'execute'),
  'Anonym: finish_shopping gesperrt');

-- Haushalt: Code darf nicht vom Client geändert werden
select throws_ok($$ update public.households set invite_code = 'AAAAAAAAAAAA' $$, '42501', null,
  'Einladungscode ist nicht änderbar');

-- Anonyme Nutzer
reset role;
select set_config('role', 'anon', true);
select throws_ok($$ select * from public.products $$, '42501', null, 'Anonym: kein Zugriff');

-- Rechte ausdrücklich vergeben, unabhängig von Supabase-Standardrechten
-- (neue Projekte ab 30.05.2026 vergeben keine mehr automatisch).
select table_privs_are('public', 'products', 'authenticated', array['SELECT','INSERT','UPDATE','DELETE'], 'authenticated: products CRUD');
select table_privs_are('public', 'list_items', 'authenticated', array['SELECT','INSERT','UPDATE','DELETE'], 'authenticated: list_items CRUD');
select table_privs_are('public', 'households', 'authenticated', array['SELECT'], 'authenticated: households nur lesen');
select column_privs_are('public', 'households', 'name', 'authenticated', array['SELECT','UPDATE'], 'authenticated: Haushaltsname änderbar');
select column_privs_are('public', 'households', 'invite_code', 'authenticated', array['SELECT'], 'authenticated: Einladungscode nicht änderbar');
select table_privs_are('public', 'household_members', 'authenticated', array['SELECT'], 'authenticated: Mitglieder nur lesen');
select table_privs_are('public', 'products', 'anon', array[]::text[], 'anon: kein Zugriff auf products');
select table_privs_are('public', 'list_items', 'anon', array[]::text[], 'anon: kein Zugriff auf list_items');
select table_privs_are('public', 'households', 'anon', array[]::text[], 'anon: kein Zugriff auf households');
select table_privs_are('public', 'household_members', 'anon', array[]::text[], 'anon: kein Zugriff auf household_members');

select * from finish();
rollback;
