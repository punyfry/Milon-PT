# Milon-PT

En personlig, minimalistisk träningslogg med en AI-coach, Milon, som håller tyst tills du ber om hjälp. Huvudsyftet är att logga pass snabbt.

Stack: SvelteKit 2 (Svelte 5) på Vercel, data som JSON-filer i Vercel Blob, Google-inloggning via Auth.js och Claude API anropat från servern.

## Principer

- Landningssidan utgår från att du är där för att logga träning: ett tryck på ett passkort startar passet.
- Coachen är tyst under passet och svarar bara när du trycker "Hjälp".
- Övningar är egna objekt med eget ID och egen logg. Pass refererar bara till övnings-ID.
- Ett pågående pass lever i webbläsaren (localStorage) tills servern bekräftat sparningen.
- Data är per användare under `users/<userId>/`. Bara den inloggade användaren når sina filer, och inga blob-URL:er lämnar servern.

## Struktur

| Fil | Vad |
| --- | --- |
| `src/auth.ts` | Auth.js: Google-provider (explicita `GOOGLE_OAUTH_*`), allowlist i `signIn`, `userId` = Googles `sub` |
| `src/hooks.server.ts` | Kedjar säkerhetsheaders, Auth.js och inloggningsvakten |
| `src/lib/server/security/` | `guard.ts` (inloggning + allowlist på varje request, utom `/login` och `/auth/*`) och `headers.ts` (säkerhetsheaders). CSP ligger i `svelte.config.js` |
| `src/lib/server/allowlist.ts` | Läser `ALLOWED_EMAILS`. Tom lista = ingen släpps in |
| `src/lib/server/storage/` | `UserStorage`-gränssnittet: Vercel Blob (privat), lokala filer i `.data/` i dev, och minne i tester. Sökvägar valideras i `paths.ts` |
| `src/lib/model/` | Datamodellen: typer, validering och id-hjälpare. Delas av server och klient |
| `src/lib/server/data/` | Läs/skriv övningar, passmallar (versionerade), sparade pass och profil. `save-session.ts` sparar ett avslutat pass och går att köra om utan dubbletter |
| `src/lib/server/import/craft.ts` | Importen från Craft: validera → planera mot befintliga data → skriv |
| `src/lib/server/ai/` | Claude-klient, modellval, modellberoende parametrar och daglig gräns (`usage.ts`) |
| `src/lib/server/builder/` | Pass-byggaren: systemprompt, verktygen `propose_exercise`/`set_workout` och konversationsloopen |
| `src/lib/server/helper/` | Hjälparen under passet: systemprompt och `swap_exercise` |
| `src/lib/session/` | Pågående pass i webbläsaren: förifyllning, −/+, timer, localStorage och kön för pass som sparats utan nät (`outbox.ts`) |
| `src/lib/history/stats.ts` | Historiken: bästa set, beräknad 1RM, rekord, veckosammanfattning och milstolpar, uträknat ur loggarna |
| `src/lib/markdown.ts` | Enkel markdown för pass-byggarens svar, renderas utan `{@html}` |
| `src/service-worker.ts` | Offlinestöd: cachar appens filer och öppnade sidor |
| `src/routes/` | `/` passkort, `/pass/[slug]` aktivt pass och avslut, `/skapa` pass-byggaren, `/historik` och `/historik/ovning/[id]`, `/konto`, `/api/*` |
| `scripts/` | `import.ts` (importskriptet) och `make_icons.py` (PWA-ikoner) |

Använd lagringen från en route så här:

```ts
import { storageFor } from '$lib/server/storage';

const storage = storageFor(locals); // scopad till inloggad användare
const profile = await storage.readJson<Profile>('profile.json');
await storage.writeJson('profile.json', data, { ifMatch: profile?.version });
```

## Kom igång lokalt

1. `npm install`
2. Kopiera `.env.example` till `.env` och fyll i värdena (se nedan).
3. `npm run dev` och öppna http://localhost:5173

Utan `BLOB_READ_WRITE_TOKEN` sparar dev-servern data i lokala filer under `.data/` (gitignorerad). I produktion krävs token.

### Miljövariabler

| Variabel | Innehåll |
| --- | --- |
| `AUTH_SECRET` | Hemlig sträng för Auth.js sessionscookie (`npx auth secret`) |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth-klient-ID. Skickas in explicit i Google-providern (Auth.js letar annars efter `AUTH_GOOGLE_ID`) |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth-hemlighet, skickas in på samma sätt |
| `ALLOWED_EMAILS` | Kommaseparerad lista över e-postadresser som får logga in |
| `BLOB_READ_WRITE_TOKEN` | Skapas när Blob-storen kopplas till Vercel-projektet |
| `ANTHROPIC_API_KEY` | Claude API-nyckel. Utan den svarar pass-byggaren och hjälparen 503 |
| `MODEL_BUILDER` | Modell för pass-byggaren (standard `claude-sonnet-5-5`) |
| `MODEL_HELPER` | Modell för hjälparen (standard `claude-haiku-4-5`) |
| `AI_DAILY_LIMIT` | Max antal anrop till Claude API per användare och dag, för pass-byggaren och hjälparen tillsammans (standard 200, `0` stänger av). En tur i pass-byggaren kan göra flera anrop |

### Google OAuth-klient

I Google Cloud Console → APIs & Services → Credentials → *Create credentials* → *OAuth client ID* (typ *Web application*):

- **Authorized JavaScript origins:** `http://localhost:5173` och din Vercel-domän, t.ex. `https://milon-pt.vercel.app`
- **Authorized redirect URIs:** `http://localhost:5173/auth/callback/google` och `https://milon-pt.vercel.app/auth/callback/google`

Om OAuth-samtyckesskärmen står i läget *Testing* måste din e-post även läggas till som testanvändare. Preview-deployer får nya URL:er, så testa inloggningen på produktionsdomänen.

### Vercel Blob

Skapa en Blob-store i Vercel-projektet (Storage → Create → Blob) med **privat** åtkomst och koppla den till projektet. Då skapas `BLOB_READ_WRITE_TOKEN`. Hämta den lokalt med `vercel env pull .env.local` eller kopiera den till `.env`.

## Datamodell

Fyra filtyper per användare, plus konversationer och räknare. Seten bor på övningen, passet är en mall som pekar på övnings-ID, och ett sparat pass är en lätt post som knyter ihop dem.

| Fil | Innehåll |
| --- | --- |
| `profile.json` | Mål, regler, veckomål och kcal-uppskattning per passtyp |
| `exercises/<exerciseId>.json` | Övning med namn, typ, instruktion, `archived` och hela loggen (nyaste först) |
| `workouts/<slug>.v<N>.json` | Passmall. Varje ändring skapar nästa version, äldre finns kvar och kan återställas |
| `sessions/<sessionId>.json` | Ett genomfört pass: mall och version, start och slut, avvikelser, kcal |
| `builder/<id>.json` | Pass-byggarens konversationer |
| `usage/<YYYY-MM-DD>.json` | Antal AI-anrop den dagen (rensas efter 30 dagar) |

```json
{
  "id": "ex_marklyft",
  "name": "Marklyft",
  "type": "weight",
  "loadClass": "heavy",
  "instruction": "Stång över mellanfoten, rak rygg, tryck golvet ifrån dig.",
  "archived": false,
  "log": [{ "sessionId": "s_20261006", "date": "2026-10-06", "sets": [{ "weight": 40, "reps": 8 }], "note": "Marginal kvar" }]
}
```

- `type`: `weight` (vikt × reps), `bodyweight` (reps) eller `time` (sekunder). Set per typ: `{ weight, reps }`, `{ reps }` eller `{ seconds }`.
- `loadClass` (bara `weight`): `light` = steg 1,25 kg, `heavy` = steg 5 kg. Tidsövningar har steg 5 s.
- Sessions-id är `s_YYYYMMDD` (svensk tid), med `_2`, `_3` … vid flera pass samma dag.
- Pågående pass ligger i localStorage under `milonpt.activeSession`; pass som väntar på nät under `milonpt.pendingSaves`.

Volym: `weight` = summa vikt × reps, `bodyweight` = summa reps, `time` = summa sekunder. Beräknad 1RM: vikt × (1 + reps / 30). Rekord räknas för bästa set (1RM, reps eller tid) och, för viktövningar, tyngsta vikt; första passet räknas aldrig som rekord.

## Skärmflöden

1. **Start:** finns ett pågående pass visas "Fortsätt pågående pass" (och "Avbryt pass", med bekräftelse) överst. Därefter senaste versionen av varje pass som kort, senast tränade först med "Senast: för 3 dagar sedan". Ett tryck startar passet direkt.
2. **Aktivt pass:** alla övningar med infällbar instruktion. Seten förifylls från senaste loggposten, annars från passmallens mål. −/+ per värde, "klar" per set, lägg till och ta bort set. Varje ändring skrivs till localStorage. Tidsövningar har en timer i setraden som räknar ner, piper vid noll och fyller i tiden; den lagrar sluttiden (`timerEndsAt`) så att den stämmer även om skärmen låses, och skärmen hålls tänd (Wake Lock). "Hjälp" per övning öppnar hjälparen; ett byte av övning blir en avvikelse i passet, inte en ändring av mallen.
3. **Avsluta:** sammanfattning med set, volym och nya rekord. Finns avvikelser får du frågan om de ska sparas som ny version av passet. kcal föreslås (profilens värde för passet, annars passtypens intervall) och kan justeras. "Spara" skriver övningsloggar och sessionspost; localStorage rensas först när servern bekräftat.
4. **Skapa pass:** chatt med pass-byggaren och en lista över övningarna som diskuteras. Godkända övningar sparas (befintliga återanvänds), och "Spara pass" skapar `v1` eller nästa version. Äldre versioner kan återställas som ny version.
5. **Historik:** vecka (dagar, pass mot veckomål, volym), milstolpar (Pull-up och Handstående, med progressionsövningar tills målet loggats), övningslista med arkiverade sist, och per övning graf och senaste passen.
6. **Konto:** veckomål och import från Craft.

## AI-coachen

Två separata anrop med var sin systemprompt, båda med verktyg (tool use) så att appen aldrig tolkar JSON ur löptext. Prompterna finns i `src/lib/server/builder/prompt.ts` och `src/lib/server/helper/prompt.ts`.

- **Pass-byggaren** (`/skapa`, Sonnet): diskuterar fram övningar med katalogen, målen och passet som redigeras som kontext. Svaren visas med enkel markdown.
- **Hjälparen** (knappen "Hjälp" under passet, Haiku): mer instruktion eller byte av övning, med passet, dagens set och övningens fem senaste loggposter som kontext. Svarar i ren text.
- Kostnad: ungefär 4–5 kr i månaden för Haiku och 12–20 kr för Sonnet vid ca 12 pass. Utöver `AI_DAILY_LIMIT`, sätt en månadsgräns för API-nyckeln i Anthropics Console. Ett Claude-abonnemang täcker inte API-anrop.

## Import från Craft

**Enklast:** logga in, gå till **Konto → Importera från Craft** och välj JSON-filen. Appen visar först vad som skulle sparas och sparar först när du trycker **Importera**. Se `scripts/import-example.json` för formatet. Utöver övningar och pass kan filen ha:

- `profile`: `goals` (text eller lista), `rules`, `kcalEstimates` (`strength`/`hiit` med `min`/`max`) och `weeklySessionGoal`. Befintliga värden skrivs aldrig över; regler läggs till.
- `note` på loggposter och `archived` på övningar.
- `sessions`: genomförda pass `{ date, workout, kcalEstimate? }`. De blir sessionsposter kl. 12 svensk tid, och loggposterna samma dag kopplas till passet.

Från kommandoraden (kräver `BLOB_READ_WRITE_TOKEN`, eller `--local` för `.data/`). Ditt användar-ID visas på `/konto`.

```sh
npm run import -- min-export.json --user <användar-ID>          # torrkörning: visar planen
npm run import -- min-export.json --user <användar-ID> --apply  # skriver
```

- Hela filen valideras först och alla fel listas med sökväg. Ingenting skrivs om något är fel.
- Övningsnamn matchas mot befintliga övningar (skiftläge och blanksteg spelar ingen roll). Befintliga namn och instruktioner skrivs aldrig över.
- Samma fil kan köras igen utan dubbletter.

## Lägg på hemskärmen (PWA)

- **Android (Chrome):** meny ⋮ → Installera app.
- **iPhone (Safari):** Dela → Lägg till på hemskärmen (inte testat, se #17).

Sidor du öppnat visas utan nät, annars visas en offlinesida. Sparar du ett pass utan nät läggs det i kö och skickas när nätet är tillbaka. Pass-byggaren och hjälparen kräver nät. Ikonerna ritas med `python3 scripts/make_icons.py static/icons` (kräver Pillow).

## Säkerhet

- Inloggning med Google och allowlist som kontrolleras på varje request. Tom lista släpper inte in någon.
- Blob-filer skrivs alltid med `access: 'private'` och sökvägar valideras så att en användare aldrig når en annans filer.
- Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, HSTS m.fl. på sidor och API-svar från servern (inte på statiska filer eller omdirigeringar till inloggningen).
- Daglig gräns för anrop till Claude API per användare (`AI_DAILY_LIMIT`). Varje anrop räknas, och gränsen kontrolleras innan något skickas.
- `/api/storage/selftest` finns bara i dev.
- `.env*` är gitignorerat. Riktig användardata hör inte hemma i repot.

## Kvalitet och CI

| Kommando | Vad |
| --- | --- |
| `npm run dev` | Utvecklingsserver |
| `npm run check` | Typkontroll (svelte-check) |
| `npm test` | Enhetstester (vitest) |
| `npm run test:coverage` | Tester med täckningsrapport |
| `npm run build` | Produktionsbygge (adapter-vercel) |
| `npm run import` | Importskriptet, se ovan |

GitHub Actions (`.github/workflows/ci.yml`) kör typkontroll, tester och bygge på varje PR och push till `main`, plus ett separat jobb med `npm audit --omit=dev --audit-level=high`. Audit-jobbet är medvetet inte ett krav för merge, så att en ny sårbarhet i ett beroende inte stoppar orelaterade PR:er; åtgärda den i en egen PR. CodeQL körs också, och Dependabot öppnar PR:er för beroenden varje vecka.

**Skydda `main`** (görs en gång i GitHub): Settings → Branches → *Add branch ruleset* (eller *Add rule*) för `main` → kryssa i *Require a pull request before merging* och *Require status checks to pass*, och välj kontrollen **Typkontroll, tester och bygge**. Kryssa gärna i *Block force pushes*.

## Utanför scope och idéer

- iPhone-stöd för den installerade appen (#17)
- Fullt offline-stöd (pass-byggaren och hjälparen utan nät)
- Vilotimer mellan set
- RPE per set och kroppsvikt med extra tillägg (viktväst)
- Extern övningsdatabas
- Fler användare: datamodellen är redan per `userId`. Det som saknas är betalning, kvot per användare och öppen inloggning i stället för allowlist.
