import type { Exercise, Profile, Target, WorkoutTemplate } from '../../model';

/** System prompt for the workout builder, with the context filled in. The prompt lives here, not in the docs. */
const TEMPLATE = `Du är Milon, en personlig tränare. Du hjälper användaren att bygga och justera träningspass genom att diskutera fram övningar, som två personer i ett samtal. Svara på svenska, kort och praktiskt. Användaren har grundkunskap i träning, så hoppa över överförklaringar.

Användarens mål och regler:
{{goals_and_rules}}

Befintliga övningar (id | namn | typ):
{{exercise_catalog}}

Passet som redigeras (tomt om nytt):
{{current_workout}}

Arbetssätt:
1. Diskutera först, föreslå sedan. Ställ högst en kort fråga åt gången.
2. Kolla alltid katalogen först. Passar en befintlig övning, använd dess id, även om användaren eller du nämner den med annat namn. Skapa en ny övning bara om ingen befintlig passar.
3. Föreslå en övning i taget med en mening om varför den passar passet.
4. När användaren godkänner en övning, anropa verktyget propose_exercise. Skriv aldrig övningsdata som JSON i texten.
5. När användaren vill spara passet, anropa set_workout med övningarna i ordning.
6. Typ är weight (vikt x reps), bodyweight (bara reps) eller time (sekunder).
7. Instruktionen ska vara 2-4 korta punkter om utgångsläge, rörelse och vanligaste felet.`;

export function formatTarget(target: Target): string {
	return 'seconds' in target ? `${target.seconds} s` : `${target.reps} reps`;
}

export function formatGoalsAndRules(profile: Profile): string {
	const parts: string[] = [];
	if (profile.goals?.trim()) parts.push(`Mål: ${profile.goals.trim()}`);
	if (profile.weeklySessionGoal) parts.push(`Veckomål: ${profile.weeklySessionGoal} pass per vecka`);
	for (const rule of profile.rules ?? []) if (rule.trim()) parts.push(`- ${rule.trim()}`);
	if (profile.coachContext?.trim()) parts.push(profile.coachContext.trim());
	return parts.length ? parts.join('\n') : '(inga angivna)';
}

export function formatCatalog(exercises: readonly Exercise[]): string {
	const active = exercises.filter((e) => !e.deleted).sort((a, b) => a.name.localeCompare(b.name, 'sv'));
	if (!active.length) return '(inga än)';
	return active.map((e) => `${e.id} | ${e.name} | ${e.type}`).join('\n');
}

export function formatWorkout(workout: WorkoutTemplate | null, names: ReadonlyMap<string, string>): string {
	if (!workout) return '(nytt pass)';
	const lines = workout.exercises.map(
		(e, i) => `${i + 1}. ${names.get(e.exerciseId) ?? e.exerciseId} (${e.exerciseId}): ${e.sets} set × ${formatTarget(e.target)}`
	);
	return `${workout.name} (version ${workout.version})\n${lines.join('\n')}`;
}

/**
 * Builds the system prompt. It is frozen when the conversation starts so
 * earlier turns never change afterwards; new exercises created during the
 * conversation reach the model through tool results instead.
 */
export function buildSystemPrompt(profile: Profile, exercises: readonly Exercise[], workout: WorkoutTemplate | null): string {
	const names = new Map(exercises.map((e) => [e.id, e.name]));
	// Replacer function, so that e.g. "$&" in the profile text is not interpreted.
	return TEMPLATE.replace('{{goals_and_rules}}', () => formatGoalsAndRules(profile))
		.replace('{{exercise_catalog}}', () => formatCatalog(exercises))
		.replace('{{current_workout}}', () => formatWorkout(workout, names));
}
