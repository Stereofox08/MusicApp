-- Запусти в Supabase → SQL Editor

create table if not exists tracks (
  id          uuid primary key default gen_random_uuid(),
  sc_id       bigint unique,
  title       text not null,
  artist      text not null default 'Unknown',
  duration    int  default 0,
  artwork_url text,
  stream_url  text,
  file_url    text,
  file_name   text,
  permalink   text,
  source      text default 'soundcloud',
  created_at  timestamptz default now()
);

create table if not exists playlists (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  created_at timestamptz default now()
);

create table if not exists playlist_tracks (
  playlist_id uuid references playlists(id) on delete cascade,
  track_id    uuid references tracks(id)    on delete cascade,
  position    int  default 0,
  primary key (playlist_id, track_id)
);

-- RLS (открытый доступ — для личного использования)
alter table tracks          enable row level security;
alter table playlists       enable row level security;
alter table playlist_tracks enable row level security;

create policy "open" on tracks          for all using (true) with check (true);
create policy "open" on playlists       for all using (true) with check (true);
create policy "open" on playlist_tracks for all using (true) with check (true);
