-- Tests für Gerichte und Wochenplan. Ausführen: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'ma@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f2', 'mb@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f3', 'mc@test.local', 'authenticated', 'authenticated');

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

create temp table codes (who text primary key, code text, id uuid);
grant select on codes to authenticated;

-- A: Haushalt mit Gericht Bolognese, am Montag geplant
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select public.create_household('Meals A');
insert into public.meals (id, household_id, name, source_url, ingredients)
  values ('50000000-0000-0000-0000-000000000001', public.my_household_id(), 'Bolognese',
          'https://example.com/bolognese', '{Hackfleisch,Spaghetti,Tomaten}');
insert into public.meal_plan (id, household_id, meal_id, day, position)
  values ('60000000-0000-0000-0000-000000000001', public.my_household_id(),
          '50000000-0000-0000-0000-000000000001', '2026-11-23', 1);

-- B: eigener Haushalt mit Gericht Curry
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select public.create_household('Meals B');
insert into public.meals (id, household_id, name, ingredients)
  values ('50000000-0000-0000-0000-000000000011', public.my_household_id(), 'Curry', '{Reis,Kokosmilch}');
insert into public.meal_plan (id, household_id, meal_id, day)
  values ('60000000-0000-0000-0000-000000000011', public.my_household_id(),
          '50000000-0000-0000-0000-000000000011', '2026-11-24');

reset role;
insert into codes select 'A', invite_code, id from public.households where created_by = '00000000-0000-0000-0000-0000000000f1';
insert into codes select 'B', invite_code, id from public.households where created_by = '00000000-0000-0000-0000-0000000000f2';

-- --- Abschottung zwischen Haushalten ----------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select is((select array_agg(name)::text from public.meals), '{Curry}', 'B sieht nur eigene Gerichte');
select is((select count(*)::int from public.meal_plan), 1, 'B sieht nur eigenen Wochenplan');
select throws_ok(
  $$ insert into public.meals (id, household_id, name) values (gen_random_uuid(), (select id from codes where who = 'A'), 'Fremd') $$,
  '42501', null, 'B kann kein Gericht in A anlegen');
select throws_ok(
  $$ insert into public.meal_plan (id, household_id, meal_id, day)
     values (gen_random_uuid(), public.my_household_id(), '50000000-0000-0000-0000-000000000001', '2026-11-25') $$,
  '23503', null, 'B kann As Gericht nicht in den eigenen Plan legen');
update public.meals set name = 'Gekapert' where id = '50000000-0000-0000-0000-000000000001';
delete from public.meal_plan where id = '60000000-0000-0000-0000-000000000001';

select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select is((select name from public.meals where id = '50000000-0000-0000-0000-000000000001'), 'Bolognese',
  'Ändern fremder Gerichte wirkt nicht');
select is((select count(*)::int from public.meal_plan), 1, 'Löschen fremder Planeinträge wirkt nicht');

-- --- Prüfregeln ------------------------------------------------------------------
select throws_ok(
  $$ insert into public.meals (id, household_id, name) values (gen_random_uuid(), public.my_household_id(), ' ') $$,
  '23514', null, 'Leerer Name wird abgelehnt');
select throws_ok(
  $$ insert into public.meals (id, household_id, name, source_url)
     values (gen_random_uuid(), public.my_household_id(), 'X', 'javascript:alert(1)') $$,
  '23514', null, 'Link muss mit http(s) beginnen');
select throws_ok(
  $$ insert into public.meals (id, household_id, name, ingredients)
     values (gen_random_uuid(), public.my_household_id(), 'Zu viel', (select array_agg('Z' || g) from generate_series(1, 101) g)) $$,
  '23514', null, 'Höchstens 100 Zutaten');

-- --- Gericht löschen entfernt es aus dem Plan --------------------------------
insert into public.meals (id, household_id, name) values ('50000000-0000-0000-0000-000000000002', public.my_household_id(), 'Suppe');
insert into public.meal_plan (id, household_id, meal_id, day)
  values (gen_random_uuid(), public.my_household_id(), '50000000-0000-0000-0000-000000000002', '2026-11-26'),
         (gen_random_uuid(), public.my_household_id(), '50000000-0000-0000-0000-000000000002', '2026-11-27');
delete from public.meals where id = '50000000-0000-0000-0000-000000000002';
select is((select count(*)::int from public.meal_plan where meal_id = '50000000-0000-0000-0000-000000000002'), 0,
  'Planeinträge eines gelöschten Gerichts verschwinden mit');

-- --- Haushalt wechseln nimmt Gerichte und Plan mit --------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select lives_ok($$ select public.switch_household((select code from codes where who = 'A')) $$, 'B wechselt zu A');
select is((select array_agg(name order by name)::text from public.meals), '{Bolognese,Curry}',
  'Bs Gericht ist mitgekommen');
select is((select ingredients::text from public.meals where name = 'Curry'), '{Reis,Kokosmilch}', 'Zutaten unverändert');
select is(
  (select array_agg(m.name || '@' || p.day order by p.day)::text from public.meal_plan p join public.meals m on m.id = p.meal_id),
  '{Bolognese@2026-11-23,Curry@2026-11-24}',
  'Bs Planeintrag zeigt auf das kopierte Gericht');
reset role;
select is((select count(*)::int from public.meals where household_id = (select id from codes where who = 'B')), 0,
  'Keine Gerichte im gelöschten Haushalt B');

-- Wer jemanden zurücklässt, nimmt nichts mit
select pg_temp.login('00000000-0000-0000-0000-0000000000f3');
select public.create_household('Meals C');
reset role;
insert into codes select 'C', invite_code, id from public.households where created_by = '00000000-0000-0000-0000-0000000000f3';
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select lives_ok($$ select public.switch_household((select code from codes where who = 'C')) $$, 'B wechselt weiter zu C');
select is((select count(*)::int from public.meals), 0, 'B nimmt aus geteiltem Haushalt keine Gerichte mit');
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select is((select count(*)::int from public.meals), 2, 'A behält beide Gerichte');

-- --- Rechte und Echtzeit -------------------------------------------------------
reset role;
select ok(not has_table_privilege('anon', 'public.meals', 'select')
          and not has_table_privilege('anon', 'public.meal_plan', 'select'), 'Anonym: keine Rechte');
select is(
  (select array_agg(tablename::text order by tablename) from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename in ('meals', 'meal_plan'))::text,
  '{meal_plan,meals}', 'Echtzeit für Gerichte und Plan aktiv');

select * from finish();
rollback;
