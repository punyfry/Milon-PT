/**
 * What Milon knows about the user (#110): the lines of the profile's goals,
 * its rules and the lines of `coachContext`, as three lists. Shown on Konto, where a line can be removed or
 * Milon can propose changes that the user approves.
 */
import type { Profile } from './types';
import { MAX_GOALS, MAX_RULE, MAX_RULES, ValidationError, isObject } from './validate';

export interface CoachNotes {
	/** The lines of `goals`. */
	goals: string[];
	rules: string[];
	/** The lines of `coachContext`, e.g. the questionnaire's `Tränar:` and `Erfarenhet:`. */
	context: string[];
}

export type NoteKind = keyof CoachNotes;

/** The lists in the order they are shown, with their Swedish names. */
export const NOTE_KINDS: readonly (readonly [NoteKind, string])[] = [
	['goals', 'Mål'],
	['rules', 'Regler'],
	['context', 'Om dig']
];

/** One line of text, without a list marker of its own ("- ", "• "). */
const oneLine = (text: string) =>
	text
		.replace(/\s+/g, ' ')
		.trim()
		.replace(/^[-•*]\s+/, '');

/** One-line texts without empty ones or duplicates, in their order. */
const lines = (items: string[]) => [...new Set(items.map(oneLine).filter(Boolean))];

/** Read the same way as parseNotes, so a stored profile and a checked proposal compare equal. */
export function coachNotes(profile: Profile): CoachNotes {
	return {
		goals: lines((profile.goals ?? '').split('\n')),
		rules: lines(profile.rules ?? []),
		context: lines((profile.coachContext ?? '').split('\n'))
	};
}

/**
 * The profile with these notes; an empty list removes the field. Only the lists that
 * changed are written, so removing a rule leaves an imported goals text exactly as it was.
 */
export function withNotes(profile: Profile, notes: CoachNotes): Profile {
	const current = coachNotes(profile);
	const changed = (kind: NoteKind) => JSON.stringify(current[kind]) !== JSON.stringify(notes[kind]);
	const next: Profile = { ...profile };
	if (changed('goals')) {
		delete next.goals;
		if (notes.goals.length) next.goals = notes.goals.join('\n');
	}
	if (changed('rules')) {
		delete next.rules;
		if (notes.rules.length) next.rules = notes.rules;
	}
	if (changed('context')) {
		delete next.coachContext;
		if (notes.context.length) next.coachContext = notes.context.join('\n');
	}
	return next;
}

export function sameNotes(a: CoachNotes, b: CoachNotes): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Checks notes from the client or from Milon: three lists of one-line texts
 * within the profile limits, without duplicates. Messages are shown to the user.
 */
export function parseNotes(raw: unknown): CoachNotes {
	const issues: string[] = [];
	const list = (key: NoteKind, label: string, max: { lines?: number; line: number; text?: number }): string[] => {
		const v = isObject(raw) ? raw[key] : undefined;
		if (!Array.isArray(v) || !v.every((x) => typeof x === 'string')) {
			issues.push(`${label} måste vara en lista med text.`);
			return [];
		}
		const items = lines(v);
		if (max.lines !== undefined && items.length > max.lines) issues.push(`${label}: högst ${max.lines} rader.`);
		if (items.some((x) => x.length > max.line)) issues.push(`${label}: en rad får vara högst ${max.line} tecken.`);
		if (max.text !== undefined && items.join('\n').length > max.text) issues.push(`${label} får vara högst ${max.text} tecken.`);
		return items;
	};
	// Goals and context are free text in the profile (the import limits only their length), so only the whole text is limited.
	const goals = list('goals', 'Mål', { line: MAX_GOALS, text: MAX_GOALS });
	const rules = list('rules', 'Regler', { lines: MAX_RULES, line: MAX_RULE });
	const context = list('context', 'Om dig', { line: MAX_GOALS, text: MAX_GOALS });
	if (issues.length) throw new ValidationError('anteckningar', issues);
	return { goals, rules, context };
}

/** What changes from `before` to `after`, per list. */
export function notesDiff(before: CoachNotes, after: CoachNotes): Record<NoteKind, { removed: string[]; added: string[] }> {
	const diff = (a: string[], b: string[]) => ({ removed: a.filter((x) => !b.includes(x)), added: b.filter((x) => !a.includes(x)) });
	return { goals: diff(before.goals, after.goals), rules: diff(before.rules, after.rules), context: diff(before.context, after.context) };
}
