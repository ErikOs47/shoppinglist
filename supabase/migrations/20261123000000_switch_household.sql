-- Haushalt wechseln: per Einladungscode einem anderen Haushalt beitreten und
-- den bisherigen verlassen. Ein Konto gehört weiterhin zu genau einem Haushalt.
--
-- War man im alten Haushalt allein, werden dessen Produkte und Zettel-Einträge
-- in den neuen Haushalt übernommen (gleichnamige Produkte zusammengeführt) und
-- der leere alte Haushalt danach gelöscht. Ist noch jemand im alten Haushalt,
-- bleiben die Daten dort.

-- Kern als interne Funktion mit Nutzer-id, damit sie auch von Hand (z. B. als
-- Hilfe bei einem falsch angelegten Haushalt) mit derselben, getesteten Logik
-- aufgerufen werden kann. Nicht über die API erreichbar (siehe revoke unten).
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
             last_purchased_at = greatest(t.last_purchased_at, o.last_purchased_at)
        from pg_temp.product_map m
        join public.products o on o.id = m.old_id
       where t.id = m.new_id;

      -- übrige Produkte mit neuer id kopieren
      insert into pg_temp.product_map (old_id, new_id)
      select o.id, gen_random_uuid()
        from public.products o
       where o.household_id = v_old
         and not exists (select 1 from pg_temp.product_map m where m.old_id = o.id);

      insert into public.products (id, household_id, name, category, favorite, purchase_count, last_purchased_at, created_at)
      select m.new_id, v_target.id, o.name, o.category, o.favorite, o.purchase_count, o.last_purchased_at, o.created_at
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

      -- leeren alten Haushalt samt seinen (jetzt kopierten) Daten löschen
      delete from public.households where id = v_old;
    end if;
  end if;

  insert into public.household_members (household_id, user_id) values (v_target.id, p_user);
  return v_target;
end $$;

revoke all on function public.switch_household_for(uuid, uuid) from public, anon, authenticated;

-- Öffentlicher Einstieg für die App: Code statt id, angemeldeter Nutzer.
create or replace function public.switch_household(p_code text)
returns public.households
language plpgsql security definer set search_path = '' as $$
declare
  target_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet' using errcode = '42501';
  end if;
  select id into target_id from public.households
   where invite_code = upper(regexp_replace(coalesce(p_code, ''), '[\s-]', '', 'g'));
  if target_id is null then
    raise exception 'Einladungscode ungültig' using errcode = 'P0001';
  end if;
  return public.switch_household_for(auth.uid(), target_id);
end $$;

revoke all on function public.switch_household(text) from public, anon;
grant execute on function public.switch_household(text) to authenticated;
