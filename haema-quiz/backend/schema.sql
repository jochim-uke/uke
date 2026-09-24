-- Quiz tables are reachable only by the server's service role, never by browser keys.
create table public.hq_weeks (id text primary key, title text not null, published_at timestamptz not null default now());
create table public.hq_sets (id text primary key, week_id text not null references public.hq_weeks(id), position int not null check(position between 1 and 3), title text not null, unique(week_id,position));
create table public.hq_questions (id text primary key, set_id text not null references public.hq_sets(id), position int not null check(position between 1 and 5), payload jsonb not null, deleted_at timestamptz, unique(set_id,position));
create table public.hq_admin (id int primary key check(id=1), password_hash text not null);
create table public.hq_sessions (token_hash text primary key, expires_at timestamptz not null);
create table public.hq_login_limits (key text primary key, window_start timestamptz not null, attempts int not null);
alter table public.hq_weeks enable row level security;
alter table public.hq_sets enable row level security;
alter table public.hq_questions enable row level security;
alter table public.hq_admin enable row level security;
alter table public.hq_sessions enable row level security;
alter table public.hq_login_limits enable row level security;
revoke all on public.hq_weeks, public.hq_sets, public.hq_questions, public.hq_admin, public.hq_sessions, public.hq_login_limits from anon, authenticated;
grant all on public.hq_weeks, public.hq_sets, public.hq_questions, public.hq_admin, public.hq_sessions, public.hq_login_limits to service_role;
create index hq_questions_active on public.hq_questions(set_id,position) where deleted_at is null;
create index hq_sessions_expiry on public.hq_sessions(expires_at);

create function public.hq_login(p_password text, p_client text) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_count int; v_global int; v_token text; v_hash text;
begin
 if length(p_password)>128 or length(p_client)>128 then return jsonb_build_object('error','Ungültige Anmeldung'); end if;
 insert into public.hq_login_limits values ('global',now(),1) on conflict(key) do update set
 attempts=case when hq_login_limits.window_start < now()-interval '15 minutes' then 1 else hq_login_limits.attempts+1 end,
 window_start=case when hq_login_limits.window_start < now()-interval '15 minutes' then now() else hq_login_limits.window_start end returning attempts into v_global;
 insert into public.hq_login_limits values (p_client,now(),1) on conflict(key) do update set
 attempts=case when hq_login_limits.window_start < now()-interval '15 minutes' then 1 else hq_login_limits.attempts+1 end,
 window_start=case when hq_login_limits.window_start < now()-interval '15 minutes' then now() else hq_login_limits.window_start end returning attempts into v_count;
 if v_count>10 or v_global>100 then return jsonb_build_object('error','Zu viele Versuche. Bitte in 15 Minuten erneut anmelden.','limited',true); end if;
 select password_hash into v_hash from public.hq_admin where id=1;
 if v_hash is null or extensions.crypt(p_password,v_hash)<>v_hash then return jsonb_build_object('error','Passwort stimmt nicht.'); end if;
 delete from public.hq_sessions where expires_at<now();
 delete from public.hq_login_limits where window_start<now()-interval '1 day';
 v_token=encode(extensions.gen_random_bytes(32),'hex');
 insert into public.hq_sessions values(encode(extensions.digest(v_token,'sha256'),'hex'),now()+interval '2 hours');
 return jsonb_build_object('token',v_token,'expiresIn',7200);
end $$;
revoke all on function public.hq_login(text,text) from public,anon,authenticated;
grant execute on function public.hq_login(text,text) to service_role;

-- Atomic, idempotent weekly ingestion. Existing weeks (including deletions) are immutable here.
create function public.hq_import_week(p_week jsonb) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare s jsonb; q jsonb; o jsonb; src jsonb; wid text; sid text; si int=0; qi int; n int;
begin
 wid=p_week->>'id';
 if wid is null or wid !~ '^\d{4}-W\d{2}$' or coalesce(length(p_week->>'title'),0)=0 or jsonb_typeof(p_week->'sets') is distinct from 'array' or jsonb_array_length(p_week->'sets')<>3 then raise exception 'Expected ISO week ID, title and exactly three sets'; end if;
 perform pg_advisory_xact_lock(hashtext('hq_import_'||wid));
 if exists(select 1 from public.hq_weeks where id=wid) then return jsonb_build_object('status','already_exists','id',wid); end if;
 insert into public.hq_weeks(id,title) values(wid,p_week->>'title');
 for s in select value from jsonb_array_elements(p_week->'sets') loop
 si=si+1; sid=wid||'-s'||si; qi=0;
 if coalesce(length(s->>'title'),0)=0 or jsonb_typeof(s->'questions') is distinct from 'array' or jsonb_array_length(s->'questions')<>5 then raise exception 'Each set requires a title and five questions'; end if;
 insert into public.hq_sets values(sid,wid,si,s->>'title');
 for q in select value from jsonb_array_elements(s->'questions') loop
 qi=qi+1;
 if coalesce(length(q->>'question'),0)<15 or coalesce(length(q->>'hint'),0)=0 or coalesce(length(q->>'explanation'),0)=0 or coalesce(length(q->>'topic'),0)=0 or coalesce(length(q->>'reviewed_at'),0)=0 then raise exception 'Missing question, hint, explanation, topic or review date'; end if;
 if jsonb_typeof(q->'options') is distinct from 'array' or jsonb_array_length(q->'options')<>4 or coalesce(q->>'correct','') not in ('A','B','C','D') then raise exception 'Four options and one correct letter required'; end if;
 n=0;
 for o in select value from jsonb_array_elements(q->'options') loop
 n=n+1;
 if o->>'value' is distinct from chr(64+n) or coalesce(length(o->>'label'),0)=0 or coalesce(length(o->>'feedback'),0)=0 then raise exception 'Options must be A through D with labels and feedback'; end if;
 end loop;
 if jsonb_typeof(q->'sources') is distinct from 'array' or jsonb_array_length(q->'sources')=0 then raise exception 'Literature sources required'; end if;
 for src in select value from jsonb_array_elements(q->'sources') loop
 if coalesce(src->>'url','') !~ '^https://' or coalesce(length(src->>'title'),0)=0 then raise exception 'HTTPS source URL and title required'; end if;
 end loop;
 insert into public.hq_questions(id,set_id,position,payload) values(sid||'-q'||qi,sid,qi,q);
 end loop;
 end loop;
 return jsonb_build_object('status','imported','id',wid,'sets',3,'questions',15);
end $$;
revoke all on function public.hq_import_week(jsonb) from public,anon,authenticated;
grant execute on function public.hq_import_week(jsonb) to service_role;
