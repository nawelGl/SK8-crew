-- =========================================================
-- Skate Sessions · schéma Supabase (v1)
-- =========================================================

-- ---------- Tables ----------

create table public.spots (
  id uuid primary key default gen_random_uuid(),
  nom text not null check (char_length(nom) between 1 and 60),
  adresse text not null default '' check (char_length(adresse) <= 140),
  created_at timestamptz not null default now()
);
-- Empêche les doublons du genre « Bords de Seine » / « bords de seine »
create unique index spots_nom_unique on public.spots (lower(nom));

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  heure time not null,
  -- Si suppression d'un spot, ses sessions restent (affichées « Spot supprimé »)
  spot_id uuid references public.spots(id) on delete set null,
  propose_par text not null check (char_length(propose_par) between 1 and 30),
  created_at timestamptz not null default now()
);
create index sessions_date_idx on public.sessions (date);

create table public.participants (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions(id) on delete cascade,
  prenom text not null check (char_length(prenom) between 1 and 30),
  created_at timestamptz not null default now()
);
create index participants_session_idx on public.participants (session_id);

-- Jetons secrets : prouvent qu'on a créé une session ou qu'on y participe.
-- Table jamais lisible depuis l'appli (RLS activé, aucune politique).
create table public.jetons (
  cible uuid primary key,
  jeton uuid not null default gen_random_uuid()
);

-- ---------- Sécurité (Row Level Security) ----------
-- Tout le monde peut LIRE spots, sessions et participants.
-- Personne ne peut écrire directement : tout passe par les fonctions plus bas.

alter table public.spots enable row level security;
alter table public.sessions enable row level security;
alter table public.participants enable row level security;
alter table public.jetons enable row level security;

create policy "lecture publique" on public.spots for select using (true);
create policy "lecture publique" on public.sessions for select using (true);
create policy "lecture publique" on public.participants for select using (true);

-- ---------- Fonctions appelées par l'appli ----------

-- Date du jour à Paris (le serveur tourne en UTC)
create or replace function public.aujourdhui()
returns date language sql stable
as $$ select (now() at time zone 'Europe/Paris')::date $$;

-- Ajouter un spot (ou renvoyer l'existant s'il a déjà le même nom)
create or replace function public.ajouter_spot(p_nom text, p_adresse text)
returns public.spots
language plpgsql security definer set search_path = public
as $$
declare r spots;
begin
  p_nom := btrim(coalesce(p_nom, ''));
  p_adresse := btrim(coalesce(p_adresse, ''));
  if char_length(p_nom) not between 1 and 60 then raise exception 'Nom de spot invalide'; end if;
  if char_length(p_adresse) > 140 then raise exception 'Adresse trop longue'; end if;

  insert into spots (nom, adresse) values (p_nom, p_adresse)
    on conflict ((lower(nom))) do nothing
    returning * into r;

  if r.id is null then
    select * into r from spots s where lower(s.nom) = lower(p_nom);
  end if;
  return r;
end $$;

-- Créer une session, renvoie son id et le jeton secret du créateur
create or replace function public.creer_session(p_date date, p_heure time, p_spot uuid, p_propose_par text)
returns table (nouvel_id uuid, nouveau_jeton uuid)
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_jeton uuid;
begin
  p_propose_par := btrim(coalesce(p_propose_par, ''));
  if char_length(p_propose_par) not between 1 and 30 then raise exception 'Prénom invalide'; end if;
  if p_date is null or p_date < aujourdhui() then raise exception 'Date passée'; end if;
  if p_heure is null then raise exception 'Heure manquante'; end if;
  if not exists (select 1 from spots s where s.id = p_spot) then raise exception 'Spot inconnu'; end if;

  insert into sessions (date, heure, spot_id, propose_par)
    values (p_date, p_heure, p_spot, p_propose_par)
    returning sessions.id into v_id;
  insert into jetons (cible) values (v_id) returning jetons.jeton into v_jeton;

  return query select v_id, v_jeton;
end $$;

-- Supprimer une session (seulement avec le jeton du créateur)
create or replace function public.supprimer_session(p_id uuid, p_jeton uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  delete from jetons j where j.cible = p_id and j.jeton = p_jeton;
  if not found then return false; end if;
  delete from jetons j where j.cible in (select p.id from participants p where p.session_id = p_id);
  delete from sessions s where s.id = p_id;
  return true;
end $$;

-- Rejoindre une session, renvoie l'id de participation et son jeton
create or replace function public.rejoindre_session(p_session uuid, p_prenom text)
returns table (nouvel_id uuid, nouveau_jeton uuid)
language plpgsql security definer set search_path = public
as $$
declare v_id uuid; v_jeton uuid;
begin
  p_prenom := btrim(coalesce(p_prenom, ''));
  if char_length(p_prenom) not between 1 and 30 then raise exception 'Prénom invalide'; end if;
  if not exists (select 1 from sessions s where s.id = p_session and s.date >= aujourdhui()) then
    raise exception 'Session introuvable ou passée';
  end if;

  insert into participants (session_id, prenom)
    values (p_session, p_prenom)
    returning participants.id into v_id;
  insert into jetons (cible) values (v_id) returning jetons.jeton into v_jeton;

  return query select v_id, v_jeton;
end $$;

-- Quitter une session (seulement avec son propre jeton)
create or replace function public.quitter_session(p_id uuid, p_jeton uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
begin
  delete from jetons j where j.cible = p_id and j.jeton = p_jeton;
  if not found then return false; end if;
  delete from participants p where p.id = p_id;
  return true;
end $$;

revoke execute on function
  public.ajouter_spot(text, text),
  public.creer_session(date, time, uuid, text),
  public.supprimer_session(uuid, uuid),
  public.rejoindre_session(uuid, text),
  public.quitter_session(uuid, uuid)
from public;

grant execute on function
  public.ajouter_spot(text, text),
  public.creer_session(date, time, uuid, text),
  public.supprimer_session(uuid, uuid),
  public.rejoindre_session(uuid, text),
  public.quitter_session(uuid, uuid)
to anon, authenticated;

-- ---------- Temps réel ----------
alter publication supabase_realtime add table public.spots, public.sessions, public.participants;