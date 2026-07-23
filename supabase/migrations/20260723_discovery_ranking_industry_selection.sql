alter table industry_seeds add column if not exists active boolean not null default true;
alter table industry_seeds add column if not exists section text;
alter table industry_seeds add column if not exists note text;

update industry_seeds
set section = case
  when ksic_code like 'CAFE:%' then 'CUSTOM'
  when substring(ksic_code, 1, 2)::integer between 1 and 3 then 'A'
  when substring(ksic_code, 1, 2)::integer between 5 and 8 then 'B'
  when substring(ksic_code, 1, 2)::integer between 10 and 34 then 'C'
  when substring(ksic_code, 1, 2)::integer = 35 then 'D'
  when substring(ksic_code, 1, 2)::integer between 36 and 39 then 'E'
  when substring(ksic_code, 1, 2)::integer between 41 and 42 then 'F'
  when substring(ksic_code, 1, 2)::integer between 45 and 47 then 'G'
  when substring(ksic_code, 1, 2)::integer between 49 and 52 then 'H'
  when substring(ksic_code, 1, 2)::integer between 55 and 56 then 'I'
  when substring(ksic_code, 1, 2)::integer between 58 and 63 then 'J'
  when substring(ksic_code, 1, 2)::integer between 64 and 66 then 'K'
  when substring(ksic_code, 1, 2)::integer = 68 then 'L'
  when substring(ksic_code, 1, 2)::integer between 70 and 73 then 'M'
  when substring(ksic_code, 1, 2)::integer between 74 and 76 then 'N'
  when substring(ksic_code, 1, 2)::integer = 84 then 'O'
  when substring(ksic_code, 1, 2)::integer = 85 then 'P'
  when substring(ksic_code, 1, 2)::integer between 86 and 87 then 'Q'
  when substring(ksic_code, 1, 2)::integer between 90 and 91 then 'R'
  when substring(ksic_code, 1, 2)::integer between 94 and 96 then 'S'
  else section
end
where ksic_code like 'CAFE:%' or ksic_code ~ '^[0-9]{3}$';

update industry_seeds
set active = section in ('G','H','I','J','K','L','M','N','P','Q','R','S','CUSTOM');

update industry_seeds
set note = '건설관리 예외후보'
where section = 'F' and note is null;

update seed_queries
set active = false
where origin = 'industry';

create table if not exists cafe_names (
  cafe_id text primary key,
  cafe_name text,
  fetched_at timestamptz not null default now(),
  fetch_error text
);

create index if not exists industry_seeds_active_section_idx
  on industry_seeds(active, section, done, ksic_code);
