-- Запусти этот SQL в Supabase → SQL Editor

-- Таблица треков
create table tracks (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  artist text not null default 'Unknown',
  file_url text not null,
  file_name text,
  source text not null default 'upload', -- 'upload' | 'soundcloud'
  artwork_url text,
  duration integer,
  created_at timestamptz default now()
);

-- Разрешаем публичный доступ (для простоты, без авторизации)
alter table tracks enable row level security;

create policy "Public read" on tracks for select using (true);
create policy "Public insert" on tracks for insert with check (true);
create policy "Public delete" on tracks for delete using (true);

-- Создай bucket в Storage:
-- Supabase → Storage → New bucket → название: "tracks" → Public bucket: ON
