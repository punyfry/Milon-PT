import { formatSet as formatSetForDisplay } from '../../format';
import type { ActiveSession, Exercise, LogEntry } from '../../model';
import { formatCatalog } from '../builder/prompt';

/** System prompt for the helper, with the context filled in. The prompt lives here, not in the docs. */
const TEMPLATE = `Du är Milon, tränaren i användarens träningsapp. {{situation}} Svara på svenska i högst fyra meningar, utan inledning.

Pass: {{workout_name}}
Övningar och dagens set hittills: {{session_state}}
Historik för aktuell övning (senaste fem): {{exercise_history}}
Tillgängliga övningar i katalogen: {{exercise_catalog}}

Regler:
- Svara bara på det som frågas. Kommentera inte set, vikter eller form oombett.
- Ber användaren om mer instruktion: ge två-tre konkreta punkter.
- Vill användaren byta övning: ge direkt två konkreta alternativ i första svaret, utan motfrågor. Båda måste träna samma muskelgrupp som övningen som byts ut, och gå att göra mitt i passet med ungefär samma utrustning. Föreslå aldrig en katalogövning som tränar en annan muskelgrupp, bara för att den finns i katalogen; föreslå hellre två nya. Fråga sedan vilket användaren väljer, och anropa swap_exercise direkt när hen svarar.
- En ny övning får ett svenskt namn när det finns ett vedertaget (Hantelrodd, inte Dumbbell rows).
- Ändra aldrig vikter eller antal set själv. Förslag på justering ges i text och användaren avgör.
- Skriv ren text utan markdown (ingen fetstil eller rubriker); radbrytningar går bra.`;

/** As in the app, but with regular spaces in the prompt. */
export function formatSet(...args: Parameters<typeof formatSetForDisplay>): string {
	return formatSetForDisplay(...args).replace(/\u00a0/g, ' ');
}

/** "Marklyft (ex_marklyft, weight): 40 kg × 8 klart, 45 kg × 6", one line per exercise. */
export function formatSessionState(session: ActiveSession, exercises: ReadonlyMap<string, Exercise>): string {
	const lines = session.exercises.map((ex) => {
		const info = exercises.get(ex.exerciseId);
		const type = info?.type ?? 'bodyweight';
		const sets = ex.sets.map((s) => `${formatSet(type, s)}${s.done ? ' klart' : ''}`).join(', ');
		return `- ${info?.name ?? ex.exerciseId} (${ex.exerciseId}, ${type}): ${sets || 'inga set'}`;
	});
	return '\n' + lines.join('\n');
}

/** The five latest log entries, newest first. Never the whole log. */
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

/**
 * `current` is the exercise the question is about: undefined means the whole
 * workout, null an exercise that could not be found.
 */
export function buildHelperPrompt(
	workoutName: string,
	session: ActiveSession,
	exercises: ReadonlyMap<string, Exercise>,
	current: Exercise | null | undefined,
	catalog: readonly Exercise[]
): string {
	// Replacer function, so that "$" in names or instructions is not interpreted.
	const situation = session.preparing
		? 'Användaren förbereder passet och har inte börjat än, och har bett om hjälp.'
		: 'Användaren tränar just nu och har bett om hjälp.';
	return TEMPLATE.replace('{{situation}}', () => situation)
		.replace('{{workout_name}}', () => workoutName)
		.replace('{{session_state}}', () => formatSessionState(session, exercises))
		.replace('{{exercise_history}}', () =>
			current === undefined ? '(frågan gäller hela passet, ingen enskild övning)' : '\n' + formatHistory(current ?? undefined)
		)
		.replace('{{exercise_catalog}}', () => '\n' + formatCatalog(catalog));
}
