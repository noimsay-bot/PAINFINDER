create table if not exists watched_cafes (
  id bigint generated always as identity primary key,
  cafe_id text not null unique,
  cafe_name text not null,
  topic_seeds jsonb not null default '[]'::jsonb,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table raw_items add column if not exists watched boolean not null default false;
alter table raw_items add column if not exists watched_cafe_id text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'raw_items_watched_cafe_id_fkey'
  ) then
    alter table raw_items
      add constraint raw_items_watched_cafe_id_fkey
      foreign key (watched_cafe_id) references watched_cafes(cafe_id) on delete set null;
  end if;
end $$;

alter table watched_cafes enable row level security;

create index if not exists watched_cafes_active_idx on watched_cafes(active, created_at);
create index if not exists raw_items_watched_idx on raw_items(watched, watched_cafe_id, collected_at desc);

comment on table watched_cafes is '로그인 상태로 원문을 확인할 수 있어 조준 수집하는 네이버 카페';
comment on column raw_items.watched is '수집 당시 활성 주목 카페 URL과 일치했는지 여부';

