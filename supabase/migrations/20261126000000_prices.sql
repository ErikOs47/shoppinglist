-- Produktpreise (Kosten-Schätzung vor dem Einkauf) und Bon-Scan.
--
-- Rein additiv:
-- - products.price_cents: zuletzt bezahlter Stückpreis in Cent (leer = unbekannt)
-- - products.receipt_names: Namen, unter denen das Produkt auf Kassenbons
--   steht (z. B. „ZOTT MONTE“ für „Yogurt“). Werden beim Bestätigen eines
--   gescannten Bons gelernt und beim nächsten Scan zuerst geprüft.
-- - receipt_scans + claim_receipt_scan(): Tageslimit für den (kostenpflichtigen)
--   Bon-Scan je Haushalt. Nur die Funktion schreibt dort, Clients haben keine Rechte.

alter table public.products
  add column price_cents integer
    check (price_cents is null or (price_cents > 0 and price_cents <= 1000000)),
  add column receipt_names text[] not null default '{}'
    check (cardinality(receipt_names) <= 20
           and '' <> all (receipt_names)
           and char_length(array_to_string(receipt_names, '')) <= 1200);

-- Rechte: authenticated hat bereits select/insert/update auf ganze Zeilen von
-- products (20261122000000_explicit_grants.sql), das gilt auch für neue Spalten.
-- Realtime für products ist schon aktiv und liefert die neuen Spalten mit.

create table public.receipt_scans (
  id           bigint generated always as identity primary key,
  household_id uuid not null references public.households (id) on delete cascade,
  created_at   timestamptz not null default now()
);
create index receipt_scans_household_idx on public.receipt_scans (household_id, created_at);
alter table public.receipt_scans enable row level security;
-- keine Policy und keine Rechte: nur claim_receipt_scan() (security definer) greift zu
revoke all on public.receipt_scans from anon, authenticated;

-- Zählt einen Scan für den eigenen Haushalt. false, wenn heute (UTC) schon
-- 20 Scans gezählt sind. Sperrt die Haushaltszeile, damit zwei gleichzeitige
-- Aufrufe das Limit nicht gemeinsam überschreiten.
create function public.claim_receipt_scan()
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_household uuid := public.my_household_id();
  used int;
begin
  if v_household is null then
    raise exception 'Kein Haushalt' using errcode = 'P0001';
  end if;
  perform 1 from public.households where id = v_household for update;
  select count(*) into used
    from public.receipt_scans
   where household_id = v_household
     and created_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  if used >= 20 then
    return false;
  end if;
  insert into public.receipt_scans (household_id) values (v_household);
  return true;
end $$;

revoke all on function public.claim_receipt_scan() from public, anon;
grant execute on function public.claim_receipt_scan() to authenticated;

-- ---------------------------------------------------------------------------
-- Haushalt wechseln: Preise und Bon-Namen mitnehmen
--
-- Ersetzt die Funktion aus 20261125000000_expenses.sql. Unverändert bis auf
-- die mit NEU markierten Stellen beim Zusammenführen und Kopieren der Produkte.
-- ---------------------------------------------------------------------------
create or replace function public.switch_household_for(p_user uuid, p_target uuid)
returns public.households
language plpgsql security definer set search_path = '' as $$
declare
  v_target public.households;
  v_old uuid;
  remaining int;
  base_pos double precision;
begin
  -- Ziel sperren, damit nicht zwei Personen gleichzeitig den letzten Platz belegen
  select * into v_target from public.households where id = p_target for update;
  if not found then
    raise exception 'Einladungscode ungültig' using errcode = 'P0001';
  end if;

  select household_id into v_old from public.household_members where user_id = p_user;
  if v_old = v_target.id then
    raise exception 'Du bist bereits in diesem Haushalt' using errcode = 'P0001';
  end if;
  if (select count(*) from public.household_members where household_id = v_target.id) >= 2 then
    raise exception 'Haushalt hat bereits zwei Mitglieder' using errcode = 'P0001';
  end if;

  if v_old is not null then
    perform 1 from public.households where id = v_old for update;
    delete from public.household_members where user_id = p_user;
    select count(*) into remaining from public.household_members where household_id = v_old;

    if remaining = 0 then
      -- Zuordnung alte Produkt-id → Produkt im Zielhaushalt
      create temp table if not exists pg_temp.product_map (old_id uuid primary key, new_id uuid not null) on commit drop;
      truncate pg_temp.product_map;

      -- gleichnamige Produkte: auf das vorhandene abbilden
      insert into pg_temp.product_map (old_id, new_id)
      select o.id, t.id
        from public.products o
        join public.products t
          on t.household_id = v_target.id
         and lower(regexp_replace(t.name, '\s+', ' ', 'g')) = lower(regexp_replace(o.name, '\s+', ' ', 'g'))
       where o.household_id = v_old;

      -- Stern und Kaufhistorie zusammenführen
      update public.products t
         set favorite = t.favorite or o.favorite,
             purchase_count = t.purchase_count + o.purchase_count,
             last_purchased_at = greatest(t.last_purchased_at, o.last_purchased_at),
             -- NEU: Preis des Ziels behalten, sonst den mitgebrachten; Bon-Namen vereinen
             price_cents = coalesce(t.price_cents, o.price_cents),
             receipt_names = (select coalesce(array_agg(n order by first_ord), '{}')
                                from (select n, min(ord) as first_ord
                                        from unnest(t.receipt_names || o.receipt_names) with ordinality as u(n, ord)
                                       group by n
                                       order by min(ord)
                                       limit 20) x)
        from pg_temp.product_map m
        join public.products o on o.id = m.old_id
       where t.id = m.new_id;

      -- übrige Produkte mit neuer id kopieren
      insert into pg_temp.product_map (old_id, new_id)
      select o.id, gen_random_uuid()
        from public.products o
       where o.household_id = v_old
         and not exists (select 1 from pg_temp.product_map m where m.old_id = o.id);

      -- NEU: Preis und Bon-Namen mitkopieren
      insert into public.products (id, household_id, name, category, favorite, purchase_count, last_purchased_at, created_at,
                                   price_cents, receipt_names)
      select m.new_id, v_target.id, o.name, o.category, o.favorite, o.purchase_count, o.last_purchased_at, o.created_at,
             o.price_cents, o.receipt_names
        from public.products o
        join pg_temp.product_map m on m.old_id = o.id
       where o.household_id = v_old
         and not exists (select 1 from public.products t where t.id = m.new_id);

      -- Zettel-Einträge hinten anfügen; steht das Produkt schon drauf, bleibt der vorhandene Eintrag
      select coalesce(max(position), 0) into base_pos from public.list_items where household_id = v_target.id;
      insert into public.list_items (id, household_id, product_id, checked, position, created_at)
      select gen_random_uuid(), v_target.id, m.new_id, l.checked,
             base_pos + row_number() over (order by l.position nulls last, l.created_at, l.id),
             l.created_at
        from public.list_items l
        join pg_temp.product_map m on m.old_id = l.product_id
       where l.household_id = v_old
      on conflict (product_id) do nothing;

      -- Gerichte mit neuer id kopieren; ihre Zutaten auf die Produkte im
      -- Zielhaushalt umbiegen (Reihenfolge bleibt, Doppelte nach Zusammenführen
      -- gleichnamiger Produkte fallen weg); Planeinträge auf die neuen ids
      create temp table if not exists pg_temp.meal_map (old_id uuid primary key, new_id uuid not null) on commit drop;
      truncate pg_temp.meal_map;
      insert into pg_temp.meal_map (old_id, new_id)
      select id, gen_random_uuid() from public.meals where household_id = v_old;

      insert into public.meals (id, household_id, name, source_url, product_ids, created_at)
      select m.new_id, v_target.id, o.name, o.source_url,
             coalesce((select array_agg(x.new_id order by x.first_ord)
                         from (select pm.new_id, min(u.ord) as first_ord
                                 from unnest(o.product_ids) with ordinality as u(id, ord)
                                 join pg_temp.product_map pm on pm.old_id = u.id
                                group by pm.new_id) x), '{}'),
             o.created_at
        from public.meals o
        join pg_temp.meal_map m on m.old_id = o.id;

      insert into public.meal_plan (id, household_id, meal_id, day, position, created_at)
      select gen_random_uuid(), v_target.id, m.new_id, p.day, p.position, p.created_at
        from public.meal_plan p
        join pg_temp.meal_map m on m.old_id = p.meal_id;

      -- Ausgaben mitnehmen (neue id, Betrag/Datum/Notiz unverändert)
      insert into public.expenses (id, household_id, amount_cents, spent_on, note, created_at)
      select gen_random_uuid(), v_target.id, e.amount_cents, e.spent_on, e.note, e.created_at
        from public.expenses e
       where e.household_id = v_old;

      -- leeren alten Haushalt samt seinen (jetzt kopierten) Daten löschen
      delete from public.households where id = v_old;
    end if;
  end if;

  insert into public.household_members (household_id, user_id) values (v_target.id, p_user);
  return v_target;
end $$;

revoke all on function public.switch_household_for(uuid, uuid) from public, anon, authenticated;
