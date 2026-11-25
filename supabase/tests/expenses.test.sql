-- Tests für Ausgaben. Ausführen: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000e7', 'xa@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e8', 'xb@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000e9', 'xc@test.local', 'authenticated', 'authenticated');

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

create temp table codes (who text primary key, code text, id uuid);
grant select on codes to authenticated;

-- A: Haushalt mit zwei Ausgaben
select pg_temp.login('00000000-0000-0000-0000-0000000000e7');
select public.create_household('Ausgaben A');
insert into public.expenses (id, household_id, amount_cents, spent_on, note)
  values ('80000000-0000-0000-0000-000000000001', public.my_household_id(), 2340, '2026-11-23', null),
         ('80000000-0000-0000-0000-000000000002', public.my_household_id(), 510, '2026-11-24', 'Bäcker');

-- B: eigener Haushalt mit einer Ausgabe
select pg_temp.login('00000000-0000-0000-0000-0000000000e8');
select public.create_household('Ausgaben B');
insert into public.expenses (id, household_id, amount_cents, spent_on)
  values ('80000000-0000-0000-0000-000000000011', public.my_household_id(), 1999, '2026-11-20');

reset role;
insert into codes select 'A', invite_code, id from public.households where created_by = '00000000-0000-0000-0000-0000000000e7';
insert into codes select 'B', invite_code, id from public.households where created_by = '00000000-0000-0000-0000-0000000000e8';

-- --- Abschottung -----------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000e8');
select is((select sum(amount_cents)::int from public.expenses), 1999, 'B sieht nur eigene Ausgaben');
select throws_ok(
  $$ insert into public.expenses (id, household_id, amount_cents, spent_on)
     values (gen_random_uuid(), (select id from codes where who = 'A'), 100, '2026-11-24') $$,
  '42501', null, 'B kann keine Ausgabe in A anlegen');
update public.expenses set amount_cents = 1 where id = '80000000-0000-0000-0000-000000000001';
delete from public.expenses where id = '80000000-0000-0000-0000-000000000002';

select pg_temp.login('00000000-0000-0000-0000-0000000000e7');
select is((select sum(amount_cents)::int from public.expenses), 2850, 'Fremdes Ändern/Löschen wirkt nicht');

-- --- Prüfregeln -------------------------------------------------------------------
select throws_ok(
  $$ insert into public.expenses (id, household_id, amount_cents, spent_on) values (gen_random_uuid(), public.my_household_id(), 0, '2026-11-24') $$,
  '23514', null, 'Betrag 0 wird abgelehnt');
select throws_ok(
  $$ insert into public.expenses (id, household_id, amount_cents, spent_on) values (gen_random_uuid(), public.my_household_id(), -500, '2026-11-24') $$,
  '23514', null, 'Negativer Betrag wird abgelehnt');
select throws_ok(
  $$ insert into public.expenses (id, household_id, amount_cents, spent_on) values (gen_random_uuid(), public.my_household_id(), 100000001, '2026-11-24') $$,
  '23514', null, 'Mehr als 1 Mio. € wird abgelehnt');
select throws_ok(
  $$ insert into public.expenses (id, household_id, amount_cents, spent_on, note) values (gen_random_uuid(), public.my_household_id(), 100, '2026-11-24', ' ') $$,
  '23514', null, 'Leere Notiz wird abgelehnt (dann null)');
select lives_ok(
  $$ update public.expenses set amount_cents = 2500 where id = '80000000-0000-0000-0000-000000000001' $$,
  'Eigene Ausgabe ändern');

-- --- Haushaltswechsel nimmt Ausgaben mit --------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000e8');
select lives_ok($$ select public.switch_household((select code from codes where who = 'A')) $$, 'B (allein) wechselt zu A');
select is((select array_agg(amount_cents order by amount_cents)::text from public.expenses), '{510,1999,2500}',
  'Bs Ausgabe ist mitgekommen, As bleiben');
reset role;
select is((select count(*)::int from public.expenses where household_id = (select id from codes where who = 'B')), 0,
  'Keine Ausgaben im gelöschten Haushalt B');

-- Wer jemanden zurücklässt, nimmt nichts mit
select pg_temp.login('00000000-0000-0000-0000-0000000000e9');
select public.create_household('Ausgaben C');
reset role;
insert into codes select 'C', invite_code, id from public.households where created_by = '00000000-0000-0000-0000-0000000000e9';
select pg_temp.login('00000000-0000-0000-0000-0000000000e8');
select public.switch_household((select code from codes where who = 'C'));
select is((select count(*)::int from public.expenses), 0, 'B nimmt aus geteiltem Haushalt keine Ausgaben mit');

-- --- Rechte und Echtzeit -----------------------------------------------------------
reset role;
select ok(not has_table_privilege('anon', 'public.expenses', 'select'), 'Anonym: keine Rechte');
select is(
  (select count(*)::int from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'expenses'),
  1, 'Echtzeit für Ausgaben aktiv');

select * from finish();
rollback;
