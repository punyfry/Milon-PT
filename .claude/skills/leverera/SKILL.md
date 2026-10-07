---
name: leverera
description: Arbetsflödet för att bygga en ändring i Milon-PT från uppgift till mergad PR - koda på egen gren, kontrollera lokalt, öppna PR, låt subagenterna milon-reviewer och milon-tester granska och testa parallellt, rätta fynden och merga när alla är nöjda. Använd för nya funktioner, buggfixar och issues i repot.
---

# Leverera en ändring

Du är kodaren. Granskningen och testningen görs av två subagenter: `milon-reviewer` (säkerhet, struktur, kommentarer, design) och `milon-tester` (täckning, enhetstester, manuella tester). Följ `CLAUDE.md` hela vägen.

## 1. Förstå och avgränsa

- Läs uppgiften (eller issuet) och den kod som berörs. Läs `README.md` för datamodell och flöden.
- **Beslut som är ägarens** (produktbeteende, UX-val, kostnad) gissar du inte. Fråga om ägaren är tillgänglig; annars välj det säkraste minimala alternativet, skriv valet i PR:en och skapa ett issue för frågan.
- En sak per PR. Upptäcker du något orelaterat: skapa ett issue i stället för att bredda PR:en.

## 2. Koda

- Ny gren från senaste `main`: `git fetch origin main && git checkout -B claude/<kort-namn> origin/main` (eller den gren du blivit tilldelad).
- Följ de hårda reglerna och konventionerna i `CLAUDE.md`. Sök efter befintliga hjälpfunktioner innan du skriver nya.
- Skriv tester för ny logik i samma ändring, särskilt för allt säkerhetsrelevant och för kantfall.
- Uppdatera `README.md` (och `CLAUDE.md` om arbetssättet ändras) när beteende, miljövariabler eller struktur ändras.

## 3. Kontrollera lokalt

```sh
npm run check   # 0 fel, 0 varningar
npm test
npm run build
```

Läs din egen diff kritiskt innan du committar: vad skulle få CI eller granskaren att underkänna den?

## 4. Committa och öppna PR

- Commit- och PR-text på svenska. Inga modellnamn i texterna.
- PR-beskrivningen: vad och varför, beslut du tagit, och **hur man testar** (lokalt och på Vercel).

## 5. Granska och testa parallellt

Starta båda subagenterna i samma meddelande så att de kör samtidigt:

- `milon-reviewer`: ge grenen/PR-numret och vad ändringen ska göra, och be om fokus på de delar som är riskabla i just den här ändringen.
- `milon-tester`: ge grenen och vilken funktionalitet som påverkas, och vilken testdata som finns.

Medan de kör: vänta på CI (GitHub Actions-kontrollen **Typkontroll, tester och bygge**, CodeQL och Vercel).

## 6. Hantera fynden

- **blocker** och **bör**: rätta, lägg till test som fångar felet, kör kontrollerna igen och pusha.
- **nit**: rätta om det är enkelt och uppenbart rätt; annars låt bli.
- Fynd som kräver ägarens beslut: skapa ett issue och nämn det i PR:en.
- Fynd du bedömer som felaktiga: verifiera själv, och skriv kort varför du inte ändrar.
- Har rättningarna ändrat något väsentligt (logik, säkerhet, UI-flöde), eller testade en subagent mot en äldre commit: kör om den subagent som berörs mot den nya koden.
- Kan en subagent inte köras (t.ex. rate limit): gör motsvarande kontroll själv och säg det i rapporten.

## 7. Merga

Merga först när:
- CI är grön på senaste commit,
- granskaren inte har några öppna blockers eller bör-fynd,
- testaren har godkänt check, tester, bygge och de manuella testerna,
- inget av ägarens beslut har gissats utan att det står i PR:en.

Squash-merga med PR-numret i titeln, till exempel `Historik: arkiverade övningar i egen grupp sist (#16)`, och sluta bevaka PR:en.

## 8. Rapportera

Ge ägaren en kort sammanfattning: vad som byggts, vad granskning och test hittade och hur det åtgärdades, vilka issues som skapats, och vad ägaren behöver göra (t.ex. sätta en miljövariabel eller testa på telefon).
