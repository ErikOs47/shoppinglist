-- Tests für Mengen auf dem Einkaufszettel. Ausführen: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(8);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000a1', 'qa@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000a2', 'qb@test.local', 'authenticated', 'authenticated');

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

create temp table codes (who text primary key, code text);
grant select on codes to authenticated;

-- A: Milch auf dem Zettel (Menge 2)
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select public.create_household('Mengen A');
insert into public.products (id, household_id, name) values
  ('a0000000-0000-0000-0000-000000000001', public.my_household_id(), 'Milch');
insert into public.list_items (id, household_id, product_id, quantity) values
  ('a1000000-0000-0000-0000-000000000001', public.my_household_id(), 'a0000000-0000-0000-0000-000000000001', 2);

-- B: Milch (Menge 5) und Eier (Menge 3), ohne Angabe = 1 für Brot
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select public.create_household('Mengen B');
insert into public.products (id, household_id, name) values
  ('a0000000-0000-0000-0000-000000000011', public.my_household_id(), 'Milch'),
  ('a0000000-0000-0000-0000-000000000012', public.my_household_id(), 'Eier'),
  ('a0000000-0000-0000-0000-000000000013', public.my_household_id(), 'Brot');
insert into public.list_items (id, household_id, product_id, quantity) values
  ('a1000000-0000-0000-0000-000000000011', public.my_household_id(), 'a0000000-0000-0000-0000-000000000011', 5),
  ('a1000000-0000-0000-0000-000000000012', public.my_household_id(), 'a0000000-0000-0000-0000-000000000012', 3);
insert into public.list_items (id, household_id, product_id) values
  ('a1000000-0000-0000-0000-000000000013', public.my_household_id(), 'a0000000-0000-0000-0000-000000000013');

select is((select quantity from public.list_items where id = 'a1000000-0000-0000-0000-000000000013'), 1, 'Ohne Angabe: Menge 1');
select lives_ok($$ update public.list_items set quantity = 99 where id = 'a1000000-0000-0000-0000-000000000013' $$, 'Menge 99 erlaubt');
select throws_ok($$ update public.list_items set quantity = 0 where id = 'a1000000-0000-0000-0000-000000000013' $$,
  '23514', null, 'Menge 0 wird abgelehnt');
select throws_ok($$ update public.list_items set quantity = 100 where id = 'a1000000-0000-0000-0000-000000000013' $$,
  '23514', null, 'Menge 100 wird abgelehnt');
select throws_ok($$ update public.list_items set quantity = null where id = 'a1000000-0000-0000-0000-000000000013' $$,
  '23502', null, 'Menge darf nicht leer sein');
update public.list_items set quantity = 4 where id = 'a1000000-0000-0000-0000-000000000013';

-- B ändert keine Mengen in A
update public.list_items set quantity = 9 where id = 'a1000000-0000-0000-0000-000000000001';
reset role;
select is((select quantity from public.list_items where id = 'a1000000-0000-0000-0000-000000000001'), 2,
  'Fremder Haushalt kann Menge nicht ändern');
insert into codes select 'A', invite_code from public.households where created_by = '00000000-0000-0000-0000-0000000000a1';

-- Haushaltswechsel: Mengen kommen mit, vorhandener Eintrag im Ziel bleibt
select pg_temp.login('00000000-0000-0000-0000-0000000000a2');
select lives_ok($$ select public.switch_household((select code from codes where who = 'A')) $$, 'B (allein) wechselt zu A');
select is(
  (select array_agg(p.name || ':' || l.quantity order by p.name)
     from public.list_items l join public.products p on p.id = l.product_id)::text,
  '{Brot:4,Eier:3,Milch:2}',
  'Mengen mitgenommen; Milch stand schon bei A und behält deren Menge');

select * from finish();
rollback;
