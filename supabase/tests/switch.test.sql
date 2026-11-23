-- Tests für „Haushalt wechseln“. Ausführen: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(22);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'sa@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000b1', 'sb@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000c1', 'sc@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000d1', 'sd@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e1', 'se@test.local', 'authenticated', 'authenticated');

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

-- Codes für die Tests merken (als postgres lesbar machen)
create temp table codes (who text primary key, code text, id uuid);
grant select on codes to authenticated;

-- A: Haushalt mit Milch (Favorit, 2× gekauft) und Brot; Milch steht auf dem Zettel
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select public.create_household('Haushalt A');
insert into public.products (id, household_id, name, category, favorite, purchase_count)
  values ('30000000-0000-0000-0000-000000000001', public.my_household_id(), 'Milch', 'Milchprodukte & Eier', true, 2),
         ('30000000-0000-0000-0000-000000000002', public.my_household_id(), 'Brot', 'Brot & Backwaren', false, 0);
insert into public.list_items (id, household_id, product_id, position)
  values ('40000000-0000-0000-0000-000000000001', public.my_household_id(), '30000000-0000-0000-0000-000000000001', 1);

-- B (versehentlich eigener Haushalt): „milch“ (3× gekauft) und Kaffee, beide auf dem Zettel
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select public.create_household('Haushalt B');
insert into public.products (id, household_id, name, category, purchase_count, last_purchased_at)
  values ('30000000-0000-0000-0000-000000000011', public.my_household_id(), 'milch', 'Sonstiges', 3, '2026-11-20'),
         ('30000000-0000-0000-0000-000000000012', public.my_household_id(), 'Kaffee', 'Getränke', 1, '2026-11-21');
insert into public.list_items (id, household_id, product_id, checked, position)
  values ('40000000-0000-0000-0000-000000000011', public.my_household_id(), '30000000-0000-0000-0000-000000000012', true, 1),
         ('40000000-0000-0000-0000-000000000012', public.my_household_id(), '30000000-0000-0000-0000-000000000011', false, 2);

reset role;
insert into codes select 'A', invite_code, id from public.households
  where created_by = '00000000-0000-0000-0000-0000000000a1';
insert into codes select 'B', invite_code, id from public.households
  where created_by = '00000000-0000-0000-0000-0000000000b1';

-- --- B wechselt zu A (allein in B → Daten mitnehmen) -----------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000b1');
select is((public.switch_household(lower((select code from codes where who = 'A')))).name, 'Haushalt A',
  'B wechselt per Code (Kleinschreibung egal) zu A');
select is(public.my_household_id(), (select id from codes where who = 'A'), 'B gehört jetzt zu A');
select is((select count(*)::int from public.household_members), 2, 'A hat jetzt zwei Mitglieder');
select is((select array_agg(name order by name)::text from public.products), '{Brot,Kaffee,Milch}',
  'Produkte zusammengeführt: gleichnamige Milch nur einmal, Kaffee übernommen');
select is((select purchase_count from public.products where name = 'Milch'), 5, 'Kaufzähler addiert (2 + 3)');
select is((select favorite from public.products where name = 'Milch'), true, 'Favorit bleibt erhalten');
select is((select last_purchased_at::date from public.products where name = 'Milch'), '2026-11-20'::date,
  'Letzter Kauf übernommen');
select is((select purchase_count from public.products where name = 'Kaffee'), 1, 'Kaffee mit Kaufhistorie übernommen');
select is(
  (select array_agg(p.name || ':' || l.checked order by l.position)::text
     from public.list_items l join public.products p on p.id = l.product_id),
  '{Milch:false,Kaffee:true}',
  'Zettel: vorhandene Milch bleibt vorn, Kaffee hinten angefügt (Haken bleibt), keine doppelte Milch');

reset role;
select is((select count(*)::int from public.households where id = (select id from codes where who = 'B')), 0,
  'Leerer alter Haushalt B ist gelöscht');
select is((select count(*)::int from public.products where household_id = (select id from codes where who = 'B')), 0,
  'Keine Datenreste von B');

-- --- Fehlerfälle -------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select public.create_household('Haushalt C');
reset role;
insert into codes select 'C', invite_code, id from public.households
  where created_by = '00000000-0000-0000-0000-0000000000c1';

select pg_temp.login('00000000-0000-0000-0000-0000000000c1');
select throws_ok($$ select public.switch_household((select code from codes where who = 'A')) $$,
  'P0001', 'Haushalt hat bereits zwei Mitglieder', 'Voller Haushalt: kein Wechsel');
select is(public.my_household_id(), (select id from codes where who = 'C'), 'Nach Fehler bleibt C in seinem Haushalt');
select throws_ok($$ select public.switch_household('FALSCHCODE00') $$, 'P0001', 'Einladungscode ungültig',
  'Falscher Code wird abgelehnt');

select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select throws_ok($$ select public.switch_household((select code from codes where who = 'A')) $$,
  'P0001', 'Du bist bereits in diesem Haushalt', 'Wechsel in den eigenen Haushalt wird abgelehnt');

-- --- Wechsel, während der Partner bleibt: Daten bleiben beim Partner ---------
select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select public.create_household('Haushalt D');
insert into public.products (id, household_id, name, category)
  values ('30000000-0000-0000-0000-000000000021', public.my_household_id(), 'Tee', 'Getränke');
reset role;
insert into codes select 'D', invite_code, id from public.households
  where created_by = '00000000-0000-0000-0000-0000000000d1';
select pg_temp.login('00000000-0000-0000-0000-0000000000e1');
select public.join_household((select code from codes where who = 'D'));
select lives_ok($$ select public.switch_household((select code from codes where who = 'C')) $$,
  'E verlässt D (D bleibt) und wechselt zu C');
select is((select count(*)::int from public.products), 0, 'E nimmt nichts mit, wenn jemand im alten Haushalt bleibt');

select pg_temp.login('00000000-0000-0000-0000-0000000000d1');
select is((select array_agg(name)::text from public.products), '{Tee}', 'D behält seine Produkte');
select is((select count(*)::int from public.household_members), 1, 'D ist jetzt allein in D');

-- --- Rechte --------------------------------------------------------------------
reset role;
select ok(not has_function_privilege('anon', 'public.switch_household(text)', 'execute'), 'Anonym: switch_household gesperrt');
select ok(not has_function_privilege('authenticated', 'public.switch_household_for(uuid, uuid)', 'execute'),
  'Interne Funktion nicht über die API aufrufbar');
select ok(not has_function_privilege('anon', 'public.switch_household_for(uuid, uuid)', 'execute'),
  'Interne Funktion auch anonym gesperrt');

select * from finish();
rollback;
