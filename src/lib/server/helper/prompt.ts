import { formatSet as formatSetForDisplay } from '../../format';
import type { ActiveSession, Exercise, LogEntry } from '../../model';
import { formatCatalog } from '../builder/prompt';

/** Systemprompten för hjälparen, ordagrant enligt SPEC.md med kontexten ifylld. */
const TEMPLATE = `Du är Milon, tränaren i användarens träningsapp. Användaren tränar just nu och har bett om hjälp. Svara på svenska i högst fyra meningar, utan inledning.

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
- Skriv ren text utan markdown (ingen fetstil eller rubriker); radbrytningar går bra.`;

/** Som i appen, men med vanliga mellanslag i prompten. */
export function formatSet(...args: Parameters<typeof formatSetForDisplay>): string {
	return formatSetForDisplay(...args).replace(/\u00a0/g, ' ');
}

/** "Marklyft (ex_marklyft, weight): 40 kg × 8 klart, 45 kg × 6" – en rad per övning. */
export function formatSessionState(session: ActiveSession, exercises: ReadonlyMap<string, Exercise>): string {
	const lines = session.exercises.map((ex) => {
		const info = exercises.get(ex.exerciseId);
		const type = info?.type ?? 'bodyweight';
		const sets = ex.sets.map((s) => `${formatSet(type, s)}${s.done ? ' klart' : ''}`).join(', ');
		return `- ${info?.name ?? ex.exerciseId} (${ex.exerciseId}, ${type}): ${sets || 'inga set'}`;
	});
	return '\n' + lines.join('\n');
}

/** De senaste fem loggposterna, nyast först. Aldrig hela loggen. */
export function formatHistory(exercise: Exercise | undefined): string {
	if (!exercise) return '(okänd övning)';
	const entries: LogEntry[] = exercise.log.slice(0, 5);
	if (!entries.length) return `${exercise.name}: ingen historik än`;
	return (
		`${exercise.name}:\n` +
		entries
			.map((e) => `- ${e.date}: ${e.sets.map((s) => formatSet(exercise.type, s)).join(', ')}${e.note ? ` (anteckning: ${e.note})` : ''}`)
			.join('\n')
	);
}

export function buildHelperPrompt(
	workoutName: string,
	session: ActiveSession,
	exercises: ReadonlyMap<string, Exercise>,
	current: Exercise | undefined,
	catalog: readonly Exercise[]
): string {
	// Funktionsersättning, så att "$" i namn eller instruktioner inte tolkas.
	return TEMPLATE.replace('{{workout_name}}', () => workoutName)
		.replace('{{session_state}}', () => formatSessionState(session, exercises))
		.replace('{{exercise_history}}', () => '\n' + formatHistory(current))
		.replace('{{exercise_catalog}}', () => '\n' + formatCatalog(catalog));
}
