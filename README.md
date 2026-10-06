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

### Google OAuth-klient

I Google Cloud Console → APIs & Services → Credentials → *Create credentials* → *OAuth client ID* (typ *Web application*):

- **Authorized JavaScript origins:** `http://localhost:5173` och din Vercel-domän, t.ex. `https://milon-pt.vercel.app`
- **Authorized redirect URIs:** `http://localhost:5173/auth/callback/google` och `https://milon-pt.vercel.app/auth/callback/google`

Om OAuth-samtyckesskärmen står i läget *Testing* måste din e-post även läggas till som testanvändare.

### Vercel Blob

Skapa en Blob-store i Vercel-projektet (Storage → Create → Blob) med **privat** åtkomst och koppla den till projektet. Då skapas `BLOB_READ_WRITE_TOKEN`. Hämta den lokalt med `vercel env pull .env.local` (läses också av Vite) eller kopiera den manuellt till `.env`.

## Kommandon

- `npm run dev` – utvecklingsserver
- `npm run check` – typkontroll
- `npm run build` – produktionsbygge (adapter-vercel)
