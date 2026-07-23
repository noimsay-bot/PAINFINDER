alter table raw_items
  add column if not exists query_text text,
  add column if not exists query_origin text;

alter table decisions
  add column if not exists reason_category text,
  add column if not exists reason_note text;

create table if not exists learning_suggestions (
  id bigint generated always as identity primary key,
  suggestion_type text not null check (suggestion_type in ('keyword','domain','prompt_example')),
  value text not null,
  source_pain_point_id uuid references pain_points(id) on delete set null,
  evidence_count integer not null default 1 check (evidence_count >= 1),
  status text not null default 'pending' check (status in ('pending','approved','dismissed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique(suggestion_type, value)
);

create table if not exists rule_exclusions (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('keyword','domain')),
  value text not null,
  source text not null default 'decision_learning',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique(kind, value)
);

alter table learning_suggestions enable row level security;
alter table rule_exclusions enable row level security;

create index if not exists decisions_latest_idx
  on decisions(pain_point_id, decided_at desc);
create index if not exists learning_suggestions_status_idx
  on learning_suggestions(status, evidence_count desc, created_at desc);
create index if not exists rule_exclusions_active_idx
  on rule_exclusions(active, kind, created_at desc);

with market_stats as (
  select
    p.id as pain_point_id,
    count(c.id)::integer as product_count,
    count(c.id) filter (where c.pricing in ('paid','freemium'))::integer as paid_count,
    count(c.id) filter (where c.pricing = 'free')::integer as free_count,
    count(c.id) filter (where c.pricing = 'public')::integer as public_count
  from pain_points p
  left join competitors c on c.pain_point_id = p.id
  where p.precision_verified_at is not null
  group by p.id
), corrected as (
  select
    pain_point_id,
    case
      when product_count = 0 then 'empty'
      when public_count > 0 then 'public_owned'
      when free_count = product_count then 'all_free'
      when paid_count >= 5 or product_count >= 5 then 'crowded'
      when paid_count >= 1 then 'paid_exists'
      else 'empty'
    end as verdict
  from market_stats
)
update scores s
set
  verdict = corrected.verdict,
  f4 = case corrected.verdict
    when 'paid_exists' then 3
    when 'empty' then 2
    when 'crowded' then 1
    when 'all_free' then 0
    when 'public_owned' then 0
    else s.f4
  end,
  verified = true
from corrected
where s.pain_point_id = corrected.pain_point_id;

with classified as (
  select
    r.id,
    case
      when concat_ws(' ', r.title, r.body, p.pain_summary) ~* '구인|구직|채용\s*공고|이직|자기소개서|이력서|면접|합격\s*수기|일자리\s*(구하|찾)|배송\s*자리|자리\s*(구하|배정)|기사\s*모집|알바\s*(구하|지원)' then '구직'
      when concat_ws(' ', r.title, r.body, p.pain_summary) ~* '어디서\s*(사|구매)|최저가|소량\s*(구매|판매)|구매\s*문의|판매\s*문의|배송\s*문의|재고\s*문의|[0-9]+\s*(개|마리|박스|세트)\s*단위|당구\s*큐대|큐대\s*(왁스|코팅|마찰)' then '구매문의'
      when concat_ws(' ', r.title, r.body, p.pain_summary) ~* '(목|어깨|허리).{0,18}(통증|아프|아파|뻐근|결림)|눈\s*(피로|아픔|통증)|거북목|손목\s*(통증|아픔)|신체\s*통증' then '신체'
      when concat_ws(' ', r.title, r.body, p.pain_summary) ~* '신사업장|사업장\s*이전|이전\s*과정|주차\s*(문제|불만)|식대\s*(상승|불만)|특정\s*날짜|예식|결혼식|신부\s*(계단\s*)?입장|버진로드|음원\s*편집\s*(길이|시간)' then '일회성'
      when concat_ws(' ', r.title, r.body, p.pain_summary) ~* '자격증|합격\s*수기|강의\s*(후기|수강)|과제\s*(제출|제작)|공부\s*(방법|시작)|시험\s*(준비|공부)' then '학습'
      when concat_ws(' ', r.title, r.body, p.pain_summary) ~* '오픈채팅|무료\s*상담|문의\s*(주세요|바랍니다)|신청\s*링크|프로필\s*링크|공동구매\s*모집|판매합니다|홍보합니다' then '홍보'
      when concat_ws(' ', r.title, r.body, p.pain_summary) ~* '이미\s*해결|해결됐|해결되었|답변.{0,20}해결|문제없이\s*사용\s*중' then '해결됨'
      else null
    end as reject_reason
  from raw_items r
  join pain_points p on p.raw_item_id = r.id
)
update raw_items r
set status = 'rule_rejected', reject_reason = classified.reject_reason
from classified
where r.id = classified.id
  and classified.reject_reason is not null;
