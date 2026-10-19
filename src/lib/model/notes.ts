/**
 * What Milon knows about the user (#110): the profile's rules and the lines of
 * `coachContext`, as two lists. Shown on Konto, where a line can be removed or
 * Milon can propose changes that the user approves.
 */
import type { Profile } from './types';
import { MAX_GOALS, MAX_RULE, MAX_RULES, ValidationError, isObject } from './validate';

export interface CoachNotes {
	rules: string[];
	/** The lines of `coachContext`, e.g. the questionnaire's `Tränar:` and `Erfarenhet:`. */
	context: string[];
}

/** Most context lines; the whole text is also limited to MAX_GOALS. */
export const MAX_CONTEXT_LINES = 30;

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();

export function coachNotes(profile: Profile): CoachNotes {
	return {
		rules: (profile.rules ?? []).map(oneLine).filter(Boolean),
		context: (profile.coachContext ?? '').split('\n').map(oneLine).filter(Boolean)
	};
}

/** The profile with these notes; an empty list removes the field. */
export function withNotes(profile: Profile, notes: CoachNotes): Profile {
	const next: Profile = { ...profile };
	delete next.rules;
	delete next.coachContext;
	if (notes.rules.length) next.rules = notes.rules;
	if (notes.context.length) next.coachContext = notes.context.join('\n');
	return next;
}

export function sameNotes(a: CoachNotes, b: CoachNotes): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Checks notes from the client or from Milon: two lists of one-line texts
 * within the profile limits, without duplicates. Messages are shown to the user.
 */
export function parseNotes(raw: unknown): CoachNotes {
	const issues: string[] = [];
	const list = (key: 'rules' | 'context', max: number, label: string): string[] => {
		const v = isObject(raw) ? raw[key] : undefined;
		if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
			issues.push(`${label} måste vara en lista med text.`);
			return [];
		}
		const items = [...new Set(v.map(oneLine).filter(Boolean))];
		if (items.length > max) issues.push(`${label}: högst ${max} rader.`);
		if (items.some((x) => x.length > MAX_RULE)) issues.push(`${label}: en rad får vara högst ${MAX_RULE} tecken.`);
		return items;
	};
	const rules = list('rules', MAX_RULES, 'Regler');
	const context = list('context', MAX_CONTEXT_LINES, 'Om dig');
	if (context.join('\n').length > MAX_GOALS) issues.push(`Om dig får vara högst ${MAX_GOALS} tecken.`);
	if (issues.length) throw new ValidationError('anteckningar', issues);
	return { rules, context };
}

/** What changes from `before` to `after`, per list. */
export function notesDiff(before: CoachNotes, after: CoachNotes) {
	const diff = (a: string[], b: string[]) => ({ removed: a.filter((x) => !b.includes(x)), added: b.filter((x) => !a.includes(x)) });
	return { rules: diff(before.rules, after.rules), context: diff(before.context, after.context) };
}
