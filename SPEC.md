# Milon-PT – specifikation

## Syfte och principer

Milon-PT är en personlig, minimalistisk träningslogg där en AI-coach finns till hands men håller tyst tills du ber om hjälp. Huvudsyftet är att logga pass snabbt.

- Landningssidan utgår från att du är där för att logga träning.
- Coachen är tyst under passet och svarar bara på begäran.
- Övningar är egna objekt med eget ID och egen logg. Pass refererar bara till övnings-ID.
- Ett pågående pass lever i webbläsaren tills det sparas, och räknas som pausat om du lämnar sidan.
- Data är per användare. Bara den inloggade användaren når sina filer.

## Stack och hosting

SvelteKit på Vercel Hobby, data som JSON-filer i Vercel Blob, Google-inloggning via Auth.js och Claude API anropat från servern.

| Del | Val | Kommentar |
| --- | --- | --- |
| Webb och API | SvelteKit (server-routes) på Vercel Hobby | Hobby är avsedd för personligt bruk |
| Lagring | Vercel Blob, JSON-filer under `users/<userId>/` | Allt går via ett litet lagringsgränssnitt, så byte till Postgres/Supabase senare rör bara ett lager |
| Inloggning | Auth.js med Google | `userId` = Googles stabila användar-ID |
| Åtkomstskydd | Allowlist över e-postadresser i miljövariabel | Skyddar API-kostnaden så att bara du kan logga in |
| AI | Claude API (Haiku 4.5 och Sonnet), anropas från server-routes | Nyckeln ligger i miljövariabel, aldrig i frontend |
| Klient | PWA med manifest | Läggs på hemskärmen på mobilen |
| Offline | Utanför scope | |

Kontrollera Vercel Blobs åtkomstmodell innan första skrivningen: filerna får inte vara publikt åtkomliga via URL. Alla läsningar ska gå via serverns API med inloggningskontroll.

**Miljövariabler**

| Variabel | Innehåll |
| --- | --- |
| `AUTH_SECRET` | Hemlig sträng för Auth.js sessionscookie |
| `GOOGLE_OAUTH_CLIENT_ID` | Google OAuth-klient-ID. Auth.js letar som standard efter `AUTH_GOOGLE_ID`, så skicka in värdet explicit i Google-providern |
| `GOOGLE_OAUTH_CLIENT_SECRET` | Google OAuth-hemlighet, skickas in explicit på samma sätt |
| `ALLOWED_EMAILS` | Kommaseparerad lista över e-postadresser som får logga in |
| `BLOB_READ_WRITE_TOKEN` | Skapas när Blob-storen kopplas till Vercel-projektet |
| `ANTHROPIC_API_KEY` | Claude API-nyckel |
| `MODEL_HELPER` | Modellsträng för hjälparen under passet |
| `MODEL_BUILDER` | Modellsträng för pass-byggaren |

Repo: https://github.com/punyfry/Milon-PT

## Datamodell

Fyra filtyper per användare. Seten bor på övningen, passet är en mall som pekar på övnings-ID, och ett sparat pass är en lätt post som knyter ihop dem.

| Fil | Innehåll |
| --- | --- |
| `profile.json` | Mål, regler och coachkontext (t.ex. träningsregler, kcal-uppskattning per passtyp) |
| `exercises/<exerciseId>.json` | Övning med namn, typ, instruktion och hela loggen |
| `workouts/<slug>.v<N>.json` | Passmall. Varje uppdatering skapar en ny fil med nästa versionssuffix, äldre versioner finns kvar |
| `sessions/<sessionId>.json` | Ett genomfört pass: mall och version, start och slut, avvikelser, kcal |

**Övning**

```json
{
  "id": "ex_marklyft",
  "name": "Marklyft",
  "type": "weight",
  "loadClass": "heavy",
  "instruction": "Stång över mellanfoten, rak rygg, tryck golvet ifrån dig. Lås ut höfterna överst.",
  "archived": false,
  "log": [
    { "sessionId": "s_20261006", "date": "2026-10-06", "sets": [{ "weight": 40, "reps": 8 }, { "weight": 40, "reps": 8 }] }
  ]
}
```

- `type`: `weight` (vikt × reps), `bodyweight` (reps) eller `time` (sekunder).
- Set per typ: `{ weight, reps }`, `{ reps }` eller `{ seconds }`.
- `loadClass` (bara `weight`): `light` = steg 1,25 kg, `heavy` = steg 5 kg. AI föreslår, du kan ändra.
- Loggen är nyaste post först. "Förra gången" är första posten.

**Passmall (version 2)**

```json
{
  "slug": "pass-b",
  "name": "Pass B",
  "version": 2,
  "createdAt": "2026-10-06",
  "changeNote": "Byt hantelpress mot axelpress",
  "exercises": [
    { "exerciseId": "ex_marklyft", "sets": 3, "target": { "reps": 8 } },
    { "exerciseId": "ex_plankan", "sets": 3, "target": { "seconds": 45 } }
  ]
}
```

Nyaste version = högsta `version` för samma `slug`. Instruktionen hör till övningen, så den följer med överallt där övningen används.

**Sparat pass**

```json
{
  "id": "s_20261006",
  "workoutSlug": "pass-b",
  "workoutVersion": 2,
  "startedAt": "2026-10-06T17:10:00+02:00",
  "endedAt": "2026-10-06T18:05:00+02:00",
  "exerciseIds": ["ex_marklyft", "ex_plankan"],
  "deviations": [{ "type": "swap", "from": "ex_hantelpress", "to": "ex_axelpress" }],
  "kcalEstimate": 300
}
```

**Pågående pass (localStorage, nyckel `milonpt.activeSession`)**

```json
{
  "sessionId": "s_20261006",
  "workoutSlug": "pass-b",
  "workoutVersion": 2,
  "startedAt": "2026-10-06T17:10:00+02:00",
  "lastActivityAt": "2026-10-06T17:42:00+02:00",
  "exercises": [
    { "exerciseId": "ex_marklyft", "sets": [{ "weight": 40, "reps": 8, "done": true }, { "weight": 42.5, "reps": 8, "done": false }] }
  ],
  "deviations": []
}
```

Vid sparning skrivs seten in i respektive övnings `log`, sessionsposten skapas och localStorage rensas först när servern bekräftat. Misslyckas sparningen ligger passet kvar lokalt och du kan försöka igen.

## Skärmflöden

Fem vyer. Inloggning med Google kommer först, sedan landar du på landningssidan.

**1. Landningssida**

- Överst, om ett pass finns i localStorage: kortet "Fortsätt pågående pass" med passnamn och tid sedan senaste aktivitet. Under det en sekundär "Avbryt pass" (släng utan att logga, med bekräftelse).
- Därefter visas senaste version av varje pass direkt som kort. Ett tryck på ett kort startar passet och skapar `activeSession` i localStorage, utan mellansteg.
- Kortet för det senast tränade passet ligger först och visar t.ex. "Senast: för 3 dagar sedan".
- Sekundära länkar: Historik, Skapa pass.

**2. Aktivt pass**

- Laddar alla övningar i passet med instruktion (infällbar). Seten förifylls från övningens senaste loggpost, annars från passmallens mål.
- Per set: vikt och reps (eller bara reps, eller sekunder) med −/+ knappar, och en "klar"-markering. Viktsteg 1,25 kg (`light`) eller 5 kg (`heavy`), reps ±1, tid ±5 s.
- Lägg till eller ta bort set per övning.
- Varje ändring skrivs direkt till localStorage.
- Per övning finns en "Hjälp"-knapp som öppnar coachen: be om mer instruktion eller byt övning. Coachen gör inget annat under passet.
- Byter du övning loggas det som avvikelse i `deviations`, passmallen rörs inte.

**Timer för tidsövningar:** För set av typen `time` sitter en timer direkt i setraden, så du aldrig behöver lämna sidan.

- Start räknar ner från målet. Vid noll hörs en kort ljudsignal som stängs av av sig själv, och uppnådd tid fylls i setet. Stoppar du före noll sparas den tid som gått.
- Tiden kan justeras manuellt med ±5 s som vanligt.
- Timern lagrar sluttidpunkt (`timerEndsAt`) i `activeSession`, inte ett intervall, så den fortsätter stämma om skärmen låses eller du byter flik.
- Skärmen hålls tänd medan timern går (Screen Wake Lock).
- Vilotimer mellan set är fortsatt utanför scope.

**3. Avsluta pass**

1. Sammanfattning: övningar, set, total volym och eventuella nya rekord.
2. Finns avvikelser: frågan "Spara ändringarna som ny version av passet?" Ja skapar nästa versionsfil, nej lämnar mallen orörd.
3. Grov kcal-uppskattning föreslås (styrka ca 250–350, HIIT ca 300–450) och kan justeras.
4. "Spara" skriver övningsloggar och sessionspost. Först när servern bekräftat rensas localStorage.

**4. Skapa och uppdatera pass**

- Chatt med pass-byggaren och en live-lista över övningarna som diskuteras. Svaren visas med enkel markdown (fetstil, kursiv, listor, rubriker som fet rad); ingen HTML från modellen renderas.
- När du godkänner en övning sparas den med instruktion, typ och `loadClass`. Finns den redan återanvänds den.
- "Spara pass" skapar ett nytt pass (`v1`) eller, vid redigering, en ny version (`v2`, `v3`, ...). Äldre versioner finns kvar och kan återställas som ny version.

**5. Historik**

Se avsnittet Historik och import.

## AI-coachen

Två separata anrop med var sin systemprompt. Båda använder verktyg (tool use) för strukturerad output, så appen aldrig behöver tolka JSON ur löptext. Coachen heter Milon.

**Pass-byggaren**

Kontext som skickas med: mål och regler från `profile.json`, katalog över befintliga övningar (id, namn, typ, loadClass) och passet som redigeras, om något.

```text
Du är Milon, en personlig tränare. Du hjälper användaren att bygga och justera träningspass genom att diskutera fram övningar, som två personer i ett samtal. Svara på svenska, kort och praktiskt. Användaren har grundkunskap i träning, så hoppa över överförklaringar.

Användarens mål och regler:
{{goals_and_rules}}

Befintliga övningar (id | namn | typ | loadClass):
{{exercise_catalog}}

Passet som redigeras (tomt om nytt):
{{current_workout}}

Arbetssätt:
1. Diskutera först, föreslå sedan. Ställ högst en kort fråga åt gången.
2. Kolla alltid katalogen först. Passar en befintlig övning, använd dess id, även om användaren eller du nämner den med annat namn. Skapa en ny övning bara om ingen befintlig passar.
3. Föreslå en övning i taget med en mening om varför den passar passet.
4. När användaren godkänner en övning, anropa verktyget propose_exercise. Skriv aldrig övningsdata som JSON i texten.
5. När användaren vill spara passet, anropa set_workout med övningarna i ordning.
6. Typ är weight (vikt x reps), bodyweight (bara reps) eller time (sekunder). Föreslå loadClass för weight: light (hantlar, isolationsövningar, steg 1,25 kg) eller heavy (stång, tunga basövningar, steg 5 kg).
7. Instruktionen ska vara 2-4 korta punkter om utgångsläge, rörelse och vanligaste felet.
```

Verktyg:

- `propose_exercise`: `existingId` (om övningen redan finns), annars `name`, `type`, `loadClass`, `instruction`. Dessutom `sets` och `target` (reps eller sekunder) som förslag till passmallen.
- `set_workout`: `name`, `changeNote` och `exercises` (lista av `exerciseId`, `sets`, `target`).

**Hjälparen under passet**

Anropas bara när du trycker "Hjälp". Kontext: passnamn, övningarna med dagens set, senaste fem loggposterna för den övning frågan gäller och din fråga. Inget skickas automatiskt.

```text
Du är Milon, tränaren i användarens träningsapp. Användaren tränar just nu och har bett om hjälp. Svara på svenska i högst fyra meningar, utan inledning.

Pass: {{workout_name}}
Övningar och dagens set hittills: {{session_state}}
Historik för aktuell övning (senaste fem): {{exercise_history}}
Tillgängliga övningar i katalogen: {{exercise_catalog}}

Regler:
- Svara bara på det som frågas. Kommentera inte set, vikter eller form oombett.
- Ber användaren om mer instruktion: ge två-tre konkreta punkter.
- Vill användaren byta övning: ge direkt två konkreta alternativ i första svaret, utan motfrågor. Båda måste träna samma muskelgrupp som övningen som byts ut, och gå att göra mitt i passet med ungefär samma utrustning. Föreslå aldrig en katalogövning som tränar en annan muskelgrupp, bara för att den finns i katalogen; föreslå hellre två nya. Fråga sedan vilket användaren väljer, och anropa swap_exercise direkt när hen svarar.
- En ny övning får ett svenskt namn när det finns ett vedertaget (Hantelrodd, inte Dumbbell rows). loadClass styr viktstegen i appen: light (hantlar, kabel, isolationsövningar, steg 1,25 kg) eller heavy (skivstång, tunga basövningar, steg 5 kg).
- Ändra aldrig vikter eller antal set själv. Förslag på justering ges i text och användaren avgör.
- Skriv ren text utan markdown (ingen fetstil eller rubriker); radbrytningar går bra.
```

Verktyg: `swap_exercise` med `fromExerciseId` och antingen `toExerciseId` eller en ny övning (`name`, `type`, `loadClass`, `instruction`). Appen lägger bytet som avvikelse i det pågående passet.

Båda anropen sker via serverns API med inloggningskontroll. Håll kontexten liten: skicka aldrig hela loggen, bara det respektive anrop behöver.

**Modellval och kostnad**

- Hjälparen under passet: Claude Haiku 4.5 ($1 in, $5 ut per miljon tokens). Korta svar, räcker gott.
- Pass-byggaren: Claude Sonnet, där resonemang om övningsval gör större skillnad.
- Modellnamnen ligger som miljövariabler (`MODEL_HELPER`, `MODEL_BUILDER`), så byte kräver ingen kodändring.
- Grov uppskattning vid ca 12 pass i månaden: Haiku ca 4–5 kr, Sonnet ca 12–20 kr.
- Kostnadsspärr: sätt månadsgräns för API-nyckeln i Anthropics Console.
- Enbart Claude API. Nyckeln ligger som miljövariabel i Vercel. Ett Claude-abonnemang (Pro/Max) täcker inte API-anrop.
- Fler användare senare: datamodellen är redan per `userId`. Det som skulle tillkomma är betalning, månadskvot per användare och öppen inloggning i stället för allowlist.

## Historik och import

Historiken räknas ut ur övningsloggarna och sessionsposterna, inget lagras separat.

| Vy | Visar |
| --- | --- |
| Vecka | Kalenderremsa med dagar som tränats, antal pass mot veckomål och total volym |
| Övning | Graf över bästa set eller beräknad 1RM över tid, plus tabell över senaste passen |
| Milstolpar | Pull-up (reps) och handstående (sekunder) över tid |
| Rekord | Nytt rekord markeras vid avslut av passet |

Volym per övningstyp: `weight` = summa av vikt × reps, `bodyweight` = summa reps, `time` = summa sekunder. Beräknad 1RM för `weight`: vikt × (1 + reps / 30).

**Engångsimport från Craft**

Pass A/B/C och loggbok importeras en gång till appens format. Importen körs som ett Node-skript som läser en JSON-fil och matchar övningsnamn mot befintliga övnings-ID innan nya skapas:

```json
{
  "exercises": [
    {
      "name": "Marklyft",
      "type": "weight",
      "loadClass": "heavy",
      "instruction": "",
      "log": [{ "date": "2026-09-29", "sets": [{ "weight": 40, "reps": 8 }] }]
    }
  ],
  "workouts": [
    { "name": "Pass A", "exercises": [{ "name": "Marklyft", "sets": 3, "target": { "reps": 8 } }] }
  ]
}
```

JSON-filen tas fram ur Craft när appen är redo att ta emot den. Saknade instruktioner kan fyllas i av pass-byggaren.

## Utanför scope, öppna beslut och byggordning

**Utanför scope (MVP)**

- Offline-stöd och köad sparning
- RPE per set
- Kroppsvikt med extra tillägg (viktväst)
- Extern övningsdatabas eller MCP
- Vilotimer

**Öppna beslut**

- Vercel Blobs åtkomstmodell: bekräfta att filerna inte blir publikt åtkomliga, annars flytta lagringslagret till Supabase.
- Pass-varianter (Pass A/B/C med varianter): egna pass eller versioner av samma pass?
- Steg för tidsövningar: 5 sekunder föreslås.

**Byggordning**

1. Skelett: SvelteKit, Auth.js med Google, allowlist, lagringsgränssnitt mot Blob
2. Datamodell och importskript
3. Landningssida med passkort, aktivt pass med localStorage, avslut och sparning
4. Pass-byggaren: skapa pass, versionering
5. Hjälparen under passet: instruktion och övningsbyte
6. Historik: vecka och per övning, därefter milstolpar och rekord
7. PWA-manifest
