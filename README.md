# MusicApp — инструкция по деплою

## 1. Supabase (база данных)

1. Зайди на supabase.com → создай новый проект
2. Открой SQL Editor → вставь содержимое `supabase_schema.sql` → Run
3. Запомни:
   - `SUPABASE_URL` — Project Settings → API → Project URL
   - `SUPABASE_SERVICE_KEY` — Project Settings → API → service_role key

---

## 2. Cloudflare R2 (хранилище файлов)

1. Зайди на cloudflare.com → My Account → R2 Object Storage
2. Создай bucket, например `musicapp`
3. Включи публичный доступ: Settings → Allow Access → Public
4. Скопируй Public URL (вида `https://pub-xxx.r2.dev`)
5. Получи API Token:
   - My Profile → API Tokens → Create Token
   - Шаблон: Edit Cloudflare Workers
   - Permissions: добавь R2:Edit для своего bucket
6. Запомни:
   - `R2_ACCOUNT_ID` — правый нижний угол главной страницы Cloudflare
   - `R2_BUCKET_NAME` — имя bucket (например `musicapp`)
   - `R2_TOKEN` — созданный API Token
   - `R2_PUBLIC_URL` — публичный URL bucket (без / в конце)

---

## 3. Vercel (деплой)

1. Зайди на vercel.com → New Project → Import Git Repository
   (или используй `vercel deploy` в папке проекта)
2. В настройках проекта добавь Environment Variables:

```
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
R2_ACCOUNT_ID=abc123
R2_BUCKET_NAME=musicapp
R2_TOKEN=xxx
R2_PUBLIC_URL=https://pub-xxx.r2.dev
```

3. Deploy!

---

## Локальная разработка

Создай файл `.env.local`:
```
VITE_API_URL=
SUPABASE_URL=https://xxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...
R2_ACCOUNT_ID=abc123
R2_BUCKET_NAME=musicapp
R2_TOKEN=xxx
R2_PUBLIC_URL=https://pub-xxx.r2.dev
```

Запусти:
```bash
npm install
npm run dev
```
