alter table watched_cafes
  add column if not exists origin text not null default 'manual';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'watched_cafes_origin_check'
  ) then
    alter table watched_cafes
      add constraint watched_cafes_origin_check
      check (origin in ('manual', 'candidate'));
  end if;
end $$;

comment on column watched_cafes.origin is 'manual: 관리 화면 등록, candidate: 후보 상세에서 즉석 추가';
