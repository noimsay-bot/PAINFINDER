create table if not exists review_settings (
  id smallint primary key default 1 check (id = 1),
  queue_size integer not null default 10 check (queue_size between 5 and 30),
  min_score integer not null default 5 check (min_score between 0 and 10),
  updated_at timestamptz not null default now()
);

insert into review_settings (id, queue_size, min_score)
values (1, 10, 5)
on conflict (id) do nothing;

alter table raw_items
  add column if not exists review_status text not null default 'eligible',
  add column if not exists review_status_reason text,
  add column if not exists review_override boolean not null default false,
  add column if not exists review_status_updated_at timestamptz;

alter table raw_items drop constraint if exists raw_items_review_status_check;
alter table raw_items
  add constraint raw_items_review_status_check
  check (review_status in ('eligible', 'auto_held', 'insufficient_signal'));

update raw_items r
set review_status = case
      when r.low_confidence then 'insufficient_signal'
      when s.verdict in ('all_free', 'public_owned') then 'auto_held'
      when s.verdict = 'crowded' and s.total < 6 then 'auto_held'
      when s.total < 5 then 'auto_held'
      else 'eligible'
    end,
    review_status_reason = case
      when r.low_confidence then 'insufficient_signal'
      when s.verdict in ('all_free', 'public_owned') then 'non_monetizable'
      when s.verdict = 'crowded' and s.total < 6 then 'crowded_weak'
      when s.total < 5 then 'low_score'
      else null
    end,
    review_status_updated_at = now()
from pain_points p
join scores s on s.pain_point_id = p.id
where p.raw_item_id = r.id
  and r.review_override = false;

alter table review_settings enable row level security;

create index if not exists raw_items_review_status_idx
  on raw_items(review_status, review_override, collected_at desc);

comment on table review_settings is '사람이 한 번에 볼 검토 큐의 크기와 최소 점수';
comment on column raw_items.review_status is '검토 큐 기준 자동 정리 상태. 원문과 후보 행은 삭제하지 않는다';
comment on column raw_items.review_override is '사용자가 자동 정리에서 되살린 후보인지 여부';

notify pgrst, 'reload schema';
