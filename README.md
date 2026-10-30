# THE BEST POS

POS na mfumo wa stock kwa duka la simu na accessories (Store + Duka). UI ya Kiswahili, msimbo kwa Kiingereza.
Muundo kamili uko kwenye `THE_BEST_POS_Prompt.pdf`.

## Hali ya sasa

Mfumo unatumia **Supabase** (Postgres + Auth + Realtime) kama chanzo pekee cha data. Hakuna data ya biashara kwenye
browser. `src/mock/*` ni nakala ya kumbukumbu ya DB (inapakiwa na `src/mock/hydrate.ts`) ambayo sheria za biashara
(`shared/*`) zinaitumia; kila mabadiliko yanapita RPC za database (`supabase/migrations/006_*`, `007_*`) kisha data inapakiwa upya.
Majaribio (`npm test`) yanaendeshwa kwenye kumbukumbu bila database.

```bash
cp .env.example .env   # weka VITE_SUPABASE_URL na VITE_SUPABASE_ANON_KEY
npm install
npm run dev            # http://localhost:5173
npm test               # vitest (sheria zote za biashara)
npm run build          # typecheck + production build + PWA
```

### Environment variables (Vercel / `.env`)

| Jina | Lazima | Maelezo |
|------|--------|---------|
| `VITE_SUPABASE_URL` | Ndiyo | `https://<project-ref>.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | Ndiyo | anon (public) key ya Supabase. **Usiweke service_role key kwenye app.** |
| `VITE_SMS_DRIVER` | Hapana | `http` ukitumia mtoa huduma wa SMS; vinginevyo SMS zinaandikwa kwenye log tu |
| `VITE_SMS_API_URL`, `VITE_SMS_API_KEY`, `VITE_SMS_SENDER_ID` | Hapana | zinahitajika tu kama `VITE_SMS_DRIVER=http` |

Migrations zinawekwa kwa `SUPABASE_ACCESS_TOKEN=... node scripts/run_migration.cjs supabase/migrations/<faili>.sql`
(token haiwekwi kwenye code wala Vercel).

### Akaunti

Watumiaji wako kwenye Supabase (Auth + `profiles`). Mmiliki anaongeza wafanyakazi kupitia ukurasa wa **Watumiaji**;
login ni namba ya simu + PIN. Hakuna akaunti za demo kwenye programu.

## Kilichojengwa

| Eneo | Skrini / sheria |
|------|-----------------|
| Msingi | Login (PIN keypad ya simu), majukumu Mmiliki/Muuzaji, layout (sidebar, swichi Duka/Store, bottom nav), PWA |
| Stock | Pokea mzigo kwa IMEI, supplier → Duka, hamisha Store → Duka, suppliers + malipo, historia ya movements, kuhesabu stock + idhini ya mmiliki |
| Mauzo | POS (IMEI, malipo mchanganyiko, deni, punguzo + PIN ya mmiliki), risiti 80/58mm, wateja, madeni na malipo yake, rudisha bidhaa, futa mauzo |
| Fedha | Matumizi, funga siku, dashboard, ripoti (P&L, miezi 6, njia za malipo, Excel/PDF), kumbukumbu za audit |
| SMS | Gateway (`LogDriver` + `HttpDriver`), ripoti ya siku, vikumbusho vya madeni, uthibitisho wa ununuzi na malipo |

Muuzaji haoni bei za kununua, faida wala madeni ya suppliers; data hizo hazitumwi kwake (si kuzificha kwenye UI tu).

## Lugha (Kiswahili / English)

Kibadilishaji kiko kwenye Mipangilio (mmiliki), na pia kwenye Zaidi, upau wa pembeni na Login, ili muuzaji naye abadilishe.
Chaguo linahifadhiwa kwenye kivinjari na linatumika papo hapo.

- `src/i18n/index.tsx`: maandishi ya Kiswahili ndiyo ufunguo; `tr('Mauzo ya leo')` hurudisha Kiingereza. Sentensi isiyo kwenye kamusi inabaki Kiswahili.
- `src/i18n/en.ts`: kamusi ya Kiingereza. Funguo zenye `{1}` / `{n}` hutumika pia kama muundo, kwa hiyo ujumbe wa makosa
  kutoka `shared/*` na mock unatafsiriwa unapofika kwenye skrini.
- Majaribio (`src/i18n/i18n.test.ts`) yanahakikisha kila ujumbe wa sheria za biashara una Kiingereza.
- SMS za wateja na risiti zilizochapishwa **zinabaki Kiswahili** kwa makusudi.
- Kuongeza sentensi mpya: iandike kwa Kiswahili ndani ya `tr(...)` (au kwenye sehemu zinazotafsiri zenyewe: `PageHeader`,
  `Field`, `Tabs`, `Kpi`, `Badge`), kisha iweke kwenye `en.ts`.

## SMS na kazi za usiku

- `shared/sms.ts`: ujumbe wa ripoti (≤ SMS 2), vikumbusho (siku 2 kabla ya tarehe na siku moja baada ya kupita), `dispatchSms`
  yenye ufunguo wa mara-moja-kwa-siku (`daily:2026-10-29`, `reminder:<sale>:<kind>:<date>`), kwa hiyo kazi zinaweza kurudiwa bila kutuma mara mbili.
- `src/mock/jobs.ts`: kazi mbili hizo hizo. Kwa sasa zinaendeshwa kutoka Mipangilio ("Tuma ripoti ya leo sasa") na kwa kipima-muda
  mmiliki akiwa na app wazi. Production: Vercel Cron.
- Kwenye Vercel Hobby, cron inaweza kukimbia mara moja kwa siku na wakati wowote ndani ya saa iliyopangwa:
  `0 18 * * *` → `/api/cron/daily-report` (saa 21:00–21:59 Dar) na `0 6 * * *` → `/api/cron/debt-reminders`.
  Hizi **hazijaongezwa kwenye `vercel.json`** kwa sababu `/api/cron/*` bado haipo.
- Mtoa huduma wa SMS wa Tanzania atachaguliwa baadaye; `HttpDriver` inasoma `SMS_API_URL`, `SMS_API_KEY`, `SMS_SENDER_ID`.

## PWA

`vite-plugin-pwa`: manifest, icons na service worker. Inahifadhi **static assets tu** (hakuna API, hakuna mauzo offline).
Maktaba za Excel/PDF hazihifadhiwi mapema; zinapakiwa unapozitumia.
