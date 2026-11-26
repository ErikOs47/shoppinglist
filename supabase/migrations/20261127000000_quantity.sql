-- Mengen auf dem Einkaufszettel („− 2 +“).
--
-- Rein additiv: list_items.quantity, Standard 1, erlaubt 1–99. Bestehende
-- Einträge bekommen 1. Rechte (update auf ganze Zeilen) und Realtime für
-- list_items gelten schon und decken die neue Spalte ab.

alter table public.list_items
  add column quantity integer not null default 1 check (quantity between 1 and 99);

-- ---------------------------------------------------------------------------
-- Haushalt wechseln: Mengen mitnehmen
--
-- Ersetzt die Funktion aus 20261126000000_prices.sql. Unverändert bis auf die
-- mit NEU markierte Stelle beim Kopieren der Zettel-Einträge. Steht das Produkt
-- im Ziel schon auf dem Zettel, bleibt dessen Eintrag samt Menge.
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
             -- Preis des Ziels behalten, sonst den mitgebrachten; Bon-Namen vereinen
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

      -- Preis und Bon-Namen mitkopieren
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
      -- NEU: Menge mitnehmen
      insert into public.list_items (id, household_id, product_id, checked, position, created_at, quantity)
      select gen_random_uuid(), v_target.id, m.new_id, l.checked,
             base_pos + row_number() over (order by l.position nulls last, l.created_at, l.id),
             l.created_at, l.quantity
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
