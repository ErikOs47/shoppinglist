-- Tests für Produktpreise, Bon-Namen und das Scan-Tageslimit. Ausführen: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(17);

insert into auth.users (id, email, aud, role) values
  ('00000000-0000-0000-0000-0000000000f1', 'pa@test.local', 'authenticated', 'authenticated'),
  ('00000000-0000-0000-0000-0000000000f2', 'pb@test.local', 'authenticated', 'authenticated');

create function pg_temp.login(uid uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  select set_config('role', 'authenticated', true);
$$;

create temp table codes (who text primary key, code text, id uuid);
grant select on codes to authenticated;

-- A: Milch ohne Preis, Brot 2,50
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select public.create_household('Preise A');
insert into public.products (id, household_id, name, category, price_cents, receipt_names) values
  ('90000000-0000-0000-0000-000000000001', public.my_household_id(), 'Milch', 'Milch & Käse', null, '{H-MILCH}'),
  ('90000000-0000-0000-0000-000000000002', public.my_household_id(), 'Brot', 'Brot & Backwaren', 250, '{}');

-- B: Milch 0,99, Brot 3,00, Butter 1,99
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select public.create_household('Preise B');
insert into public.products (id, household_id, name, category, price_cents, receipt_names) values
  ('90000000-0000-0000-0000-000000000011', public.my_household_id(), 'milch', 'Milch & Käse', 99, '{"MILCH 1,5%",H-MILCH}'),
  ('90000000-0000-0000-0000-000000000012', public.my_household_id(), 'Brot', 'Brot & Backwaren', 300, '{}'),
  ('90000000-0000-0000-0000-000000000013', public.my_household_id(), 'Butter', 'Milch & Käse', 199, '{KERRYGOLD}');

reset role;
insert into codes select 'A', invite_code, id from public.households where created_by = '00000000-0000-0000-0000-0000000000f1';

-- --- Prüfregeln -------------------------------------------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select lives_ok(
  $$ update public.products set price_cents = 129 where id = '90000000-0000-0000-0000-000000000013' $$,
  'Preis ändern');
select lives_ok(
  $$ update public.products set price_cents = null where id = '90000000-0000-0000-0000-000000000013' $$,
  'Preis löschen (unbekannt)');
select throws_ok(
  $$ update public.products set price_cents = 0 where id = '90000000-0000-0000-0000-000000000013' $$,
  '23514', null, 'Preis 0 wird abgelehnt');
select throws_ok(
  $$ update public.products set price_cents = -5 where id = '90000000-0000-0000-0000-000000000013' $$,
  '23514', null, 'Negativer Preis wird abgelehnt');
select throws_ok(
  $$ update public.products set price_cents = 1000001 where id = '90000000-0000-0000-0000-000000000013' $$,
  '23514', null, 'Mehr als 10.000 € wird abgelehnt');
select throws_ok(
  $$ update public.products set receipt_names = '{""}' where id = '90000000-0000-0000-0000-000000000013' $$,
  '23514', null, 'Leerer Bon-Name wird abgelehnt');
select throws_ok(
  $$ update public.products set receipt_names = (select array_agg('N' || g) from generate_series(1, 21) g)
     where id = '90000000-0000-0000-0000-000000000013' $$,
  '23514', null, 'Mehr als 20 Bon-Namen werden abgelehnt');
update public.products set price_cents = 199 where id = '90000000-0000-0000-0000-000000000013';

-- B ändert keine Preise in A
update public.products set price_cents = 1 where id = '90000000-0000-0000-0000-000000000002';
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select is((select price_cents from public.products where id = '90000000-0000-0000-0000-000000000002'), 250,
  'Fremder Haushalt kann Preis nicht ändern');

-- --- Tageslimit für den Bon-Scan ---------------------------------------------------
select is((select count(*)::int from generate_series(1, 20) g where public.claim_receipt_scan()), 20,
  '20 Scans pro Tag erlaubt');
select is(public.claim_receipt_scan(), false, 'Der 21. Scan wird abgelehnt');
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select is(public.claim_receipt_scan(), true, 'Limit gilt je Haushalt');
select throws_ok($$ select count(*) from public.receipt_scans $$, '42501', null, 'Scan-Zähler nicht lesbar');
reset role;
select ok(not has_function_privilege('anon', 'public.claim_receipt_scan()', 'execute'), 'Anonym: kein Scan');
-- gestrige Scans zählen nicht
update public.receipt_scans set created_at = now() - interval '1 day'
 where household_id = (select id from codes where who = 'A');
select pg_temp.login('00000000-0000-0000-0000-0000000000f1');
select is(public.claim_receipt_scan(), true, 'Am nächsten Tag geht es wieder');

-- --- Haushaltswechsel nimmt Preise und Bon-Namen mit ---------------------------------
select pg_temp.login('00000000-0000-0000-0000-0000000000f2');
select lives_ok($$ select public.switch_household((select code from codes where who = 'A')) $$, 'B (allein) wechselt zu A');
select is(
  (select array_agg(name || ':' || coalesce(price_cents::text, '-') || ':' || array_to_string(receipt_names, '|') order by name)
     from public.products)::text,
  '{Brot:250:,Butter:199:KERRYGOLD,"Milch:99:H-MILCH|MILCH 1,5%"}',
  'Gleichnamige: Ziel-Preis bleibt, fehlender wird übernommen, Bon-Namen vereint; übrige kopiert');
reset role;
select is((select count(*)::int from public.receipt_scans where household_id not in (select id from public.households)), 0,
  'Scan-Zähler des gelöschten Haushalts ist weg');

select * from finish();
rollback;
