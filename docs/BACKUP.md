# Backup ya database kwenda Google Drive

Kila usiku saa **6:00 (saa za Dar)** GitHub Actions inachukua backup ya database ya Supabase na kuipakia kwenye
Google Drive yako. **Picha hazipakiwi** (ziko Cloudflare R2); backup ina link zake tu.

| Folda kwenye Drive | Faili | Inatunzwa |
|---|---|---|
| `THE BEST Backups/Kila siku` | `thebest-2026-11-26.sql.gz` (backup kamili) | siku 30 za mwisho |
| `THE BEST Backups/Kila mwezi` | `thebest-2026-11.sql.gz` + `thebest-2026-11.xlsx` | miaka 10 |
| `THE BEST Backups/Kila mwaka` | `thebest-2026.sql.gz` + `thebest-2026.xlsx` | milele |
| `THE BEST Backups/Ripoti` | `ripoti-2026-11.txt` (idadi ya rekodi + jaribio la kurudisha) | milele |

**Backup kamili** ina: bidhaa, bei, IMEI, stock ya Store na Duka, harakati na uhamisho, kuhesabu stock, mauzo na bidhaa
zake, malipo yote, marejesho, madeni, wateja, matumizi, kufunga siku, suppliers na manunuzi, watumiaji (pamoja na
akaunti za kuingia), mipangilio na kumbukumbu za audit.

**Excel ya mwezi/mwaka** (inafunguka bila app): Mauzo, Bidhaa zilizouzwa, Malipo, Matumizi, Madeni (sasa), Stock (sasa),
Wateja (sasa).

Kila mwisho wa mwezi backup inarudishwa kwenye database tupu ya majaribio na idadi ya rekodi za kila jedwali
inalinganishwa. Matokeo yanaandikwa kwenye `Ripoti/ripoti-YYYY-MM.txt`. Backup ikishindwa, GitHub inakutumia email.

---

## Kuweka (mara moja)

### 1. Google Cloud: ruhusa ya kupakia kwenye Drive yako
1. Fungua [console.cloud.google.com](https://console.cloud.google.com) kwa Gmail yako → **New project**: `THE BEST Backup`.
2. **APIs & Services → Library** → tafuta **Google Drive API** → **Enable**.
3. **APIs & Services → OAuth consent screen** (au "Google Auth Platform"):
   - User type: **External**, jina la app: `THE BEST Backup`, email yako.
   - **Audience → Publish app** (iwe *In production*). Ikibaki *Testing*, ruhusa inakwisha baada ya siku 7.
4. **Credentials → Create credentials → OAuth client ID** → Application type: **Desktop app** → **Create**.
   Nakili **Client ID** na **Client Secret**.

### 2. Refresh token (kwenye kompyuta yako, mara moja)
```powershell
cd D:\bestpos
node scripts/backup/get-refresh-token.mjs
```
Weka Client ID na Client Secret, ingia kwa Gmail yako, bofya **Allow** (Google inaweza kusema "app hii
haijathibitishwa": bofya **Advanced → Go to THE BEST Backup**, ni app yako mwenyewe). Nakili **refresh token**
inayoonekana kwenye terminal.

Ruhusa inayoombwa ni `drive.file` tu: backup inaona folda na faili ilizounda yenyewe, si faili zako zingine.

### 3. Connection string ya database
Supabase → project → **Connect** → **Session pooler** → nakili URI, na uweke password ya database mahali pa
`[YOUR-PASSWORD]`. (Session pooler inahitajika: GitHub Actions haifiki anwani ya moja kwa moja, ambayo ni IPv6.)

### 4. GitHub Secrets
GitHub → repo `thebest` → **Settings → Secrets and variables → Actions → New repository secret**:

| Name | Value |
|---|---|
| `SUPABASE_DB_URL` | URI ya Session pooler (hatua 3) |
| `GDRIVE_CLIENT_ID` | Client ID (hatua 1) |
| `GDRIVE_CLIENT_SECRET` | Client Secret (hatua 1) |
| `GDRIVE_REFRESH_TOKEN` | Refresh token (hatua 2) |

### 5. Jaribu sasa hivi
GitHub → **Actions → Backup ya database → Run workflow** (washa *Tengeneza pia faili za mwezi* ili kuona Excel na
jaribio la kurudisha). Baada ya dakika 2–4, folda `THE BEST Backups` itaonekana kwenye Drive yako.

---

## Kurudisha backup (database ikifa au data ikipotea)

1. Pakua backup unayotaka kutoka Drive (mf. `Kila siku/thebest-2026-11-26.sql.gz`) na ufungue (unzip) upate `.sql`.
2. Chagua mahali pa kurudisha:
   - **Project mpya ya Supabase** (database ya zamani imekufa): unda project, kisha tumia connection string yake.
   - **Project ile ile** (data imefutwa kwa makosa): kwanza piga backup ya hali ya sasa, kisha futa schema `public`
     (Supabase → SQL Editor: `drop schema public cascade; create schema public;`).
3. Rudisha:
   ```powershell
   psql "URI-YA-DATABASE" -f thebest-2026-11-26.sql
   ```
   Ujumbe wa "already exists" kwa vitu vya Supabase (schema, roles, akaunti zilizopo) ni wa kawaida.
4. Ukiwa umerudisha kwenye project mpya: weka `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` mpya kwenye Vercel, na
   uwashe Realtime kwa majedwali (Database → Publications → `supabase_realtime`).

Picha hazihitaji kurudishwa: ziko R2, na link zake ziko ndani ya backup.

---

## Mambo ya kukumbuka
- **Repo ya umma:** GitHub inazima ratiba (schedule) ya repo ya umma isiyo na commit kwa siku 60. Ili backup isisimame:
  fanya repo iwe **Private** (Settings → General → Change visibility), au hakikisha kuna commit angalau mara moja kwa
  miezi miwili. Logs za Actions za repo ya umma zinaonekana kwa kila mtu; backup haiandiki taarifa za biashara kwenye log.
- **Nakala ya pili:** kila Januari, pakua folda ya mwaka uliopita kwenye flash au hard disk ya ofisi.
- **Kikomo cha Drive:** backup moja ni KB chache hadi MB chache; miaka 10 inatoshea ndani ya GB 15 za bure.
