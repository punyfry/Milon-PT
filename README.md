# Milon-PT

Minimalistisk träningslogg med AI-coach. Se [SPEC.md](SPEC.md) för specifikationen.

Stack: SvelteKit, Vercel (Blob), Auth.js med Google, Claude API.

## Struktur

| Fil | Vad |
| --- | --- |
| `src/auth.ts` | Auth.js-konfiguration: Google-provider (explicita `GOOGLE_OAUTH_*`), allowlist i `signIn`-callbacken, `userId` = Googles `sub` |
| `src/hooks.server.ts` | Kräver inloggning + allowlist på alla routes utom `/login` och `/auth/*`. Sätter `locals.user` |
| `src/lib/server/allowlist.ts` | Läser `ALLOWED_EMAILS`. Tom lista = ingen släpps in |
| `src/lib/server/storage/` | Lagringsgränssnittet (`UserStorage`) och Vercel Blob-implementationen. Allt skrivs med `access: 'private'` under `users/<userId>/` och inga blob-URL:er lämnar servern |
| `src/lib/model/` | Datamodellen (typer enligt SPEC.md), validering och id-hjälpare. Delas av server och klient |
| `src/lib/server/data/` | Läs/skriv övningar, passmallar (versionerade), sparade pass och profil via lagringsgränssnittet. Allt valideras vid läsning och skrivning |
| `src/lib/server/import/craft.ts` | Engångsimporten: validera fil → planera mot befintliga data → skriv |
| `scripts/import.ts` | Kommandoradsskript för importen |
| `src/lib/session/` | Det pågående passet i webbläsaren: förifyllning, −/+, set, timer, sammanfattning och localStorage |
| `src/lib/server/data/save-session.ts` | Sparar ett avslutat pass: övningsloggar, ev. ny passversion och sist sessionsposten. Går att köra om utan dubbletter |
| `src/routes/pass/[slug]` | Aktivt pass och avslut |
| `src/lib/server/builder/` | Pass-byggaren: systemprompt, verktygen `propose_exercise`/`set_workout` och konversationsloopen mot Claude API |
| `src/routes/skapa` | Skapa och redigera pass i chatt med Milon, live-lista och versioner |
| `src/lib/server/helper/` | Hjälparen under passet: systemprompt, `swap_exercise` och anropet (`POST /api/helper`) |
| `src/lib/server/ai/` | Delat för Claude API: klient, modellval (`MODEL_BUILDER`, `MODEL_HELPER`) och modellberoende parametrar |
| `src/routes/api/storage/selftest` | `POST` skriver och läser tillbaka `users/<userId>/_selftest.json` för att verifiera Blob-kopplingen |

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

### Google OAuth-klient

I Google Cloud Console → APIs & Services → Credentials → *Create credentials* → *OAuth client ID* (typ *Web application*):

- **Authorized JavaScript origins:** `http://localhost:5173` och din Vercel-domän, t.ex. `https://milon-pt.vercel.app`
- **Authorized redirect URIs:** `http://localhost:5173/auth/callback/google` och `https://milon-pt.vercel.app/auth/callback/google`

Om OAuth-samtyckesskärmen står i läget *Testing* måste din e-post även läggas till som testanvändare.

### Vercel Blob

Skapa en Blob-store i Vercel-projektet (Storage → Create → Blob) med **privat** åtkomst och koppla den till projektet. Då skapas `BLOB_READ_WRITE_TOKEN`. Hämta den lokalt med `vercel env pull .env.local` (läses också av Vite) eller kopiera den manuellt till `.env`.

## Import från Craft

Importfilen har formatet i SPEC.md, se `scripts/import-example.json`. Ditt användar-ID (Googles `sub`) visas på startsidan när du är inloggad.

```sh
npm run import -- min-export.json --user <användar-ID>          # torrkörning: visar planen
npm run import -- min-export.json --user <användar-ID> --apply  # skriver till Blob
```

- Hela filen valideras först, och alla fel listas med sökväg (t.ex. `exercises[2].log[0].sets[1].reps`). Ingenting skrivs om något är fel.
- Övningsnamn matchas mot befintliga övningar (skiftläge och blanksteg spelar ingen roll) innan nya skapas. En matchad övning får de nya loggposterna och en instruktion om den saknar en, men ett befintligt namn eller en befintlig instruktion skrivs aldrig över.
- Pass får slug ur namnet (`Pass A` → `pass-a`). Finns passet redan med annat innehåll skapas nästa version, och äldre versioner ligger kvar.
- Samma fil kan köras igen utan dubbletter: identiska loggposter och oförändrade pass hoppas över.
- `weight`-övningar utan `loadClass` får `light` (med en varning).
- Skriptet läser `BLOB_READ_WRITE_TOKEN` från miljön, `.env.local` eller `.env`.
- Med `--local` skrivs i stället till `.data/`, den lokala lagringen som dev-servern använder utan Blob-token.

## Kommandon

- `npm run dev` – utvecklingsserver
- `npm run check` – typkontroll
- `npm test` – enhetstester (vitest)
- `npm run import` – importskriptet, se ovan
- `npm run build` – produktionsbygge (adapter-vercel)
