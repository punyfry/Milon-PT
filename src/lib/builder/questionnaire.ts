/**
 * The questionnaire for describing a new workout to Milon (#102). It only
 * writes the first message of the ordinary builder chat: the answers are put
 * together here, in the browser, from fixed Swedish templates (no AI call).
 * Answers about the user can also be saved to the profile, as lines in
 * `coachContext` and a rule, which Milon reads with every call.
 */
import { MAX_GOALS, MAX_RULE, MAX_RULES, type Profile } from '$lib/model';

/** The value of the "Annat…" option; its text is in `Answer.other`. */
export const OTHER = 'annat';

/** Longest "Annat…" text, and longest free text for the last question. */
export const MAX_OTHER = 200;
export const MAX_MORE = 500;
/** The builder's message limit (the composer's maxlength). */
export const MAX_MESSAGE = 2000;

/** Answers that can be saved to the profile. */
export type ProfileFact = 'place' | 'experience' | 'avoid';

export interface ChoiceQuestion {
	id: 'focus' | 'time' | 'intensity' | 'warmup' | 'place' | 'experience';
	kind: 'radio' | 'checkbox';
	title: string;
	/** `phrase` is how the option reads in the message; the label is used when missing. */
	options: { value: string; label: string; phrase?: string }[];
	fact?: ProfileFact;
}

export interface TextQuestion {
	id: 'avoid' | 'more';
	kind: 'text';
	title: string;
	hint: string;
	max: number;
	fact?: ProfileFact;
}

export type Question = ChoiceQuestion | TextQuestion;
export type QuestionId = Question['id'];

export const QUESTIONS: readonly Question[] = [
	{
		id: 'focus',
		kind: 'checkbox',
		title: 'Vad ska passet fokusera på?',
		options: [
			{ value: 'helkropp', label: 'Helkropp' },
			{ value: 'ben', label: 'Ben' },
			{ value: 'rygg', label: 'Rygg' },
			{ value: 'brost-axlar', label: 'Bröst och axlar' },
			{ value: 'core', label: 'Core' },
			{ value: 'kondition', label: 'Kondition' },
			{ value: 'rorlighet', label: 'Rörlighet' }
		]
	},
	{
		id: 'time',
		kind: 'radio',
		title: 'Hur lång tid har du?',
		options: [
			{ value: '20', label: '20 min', phrase: '20 minuter' },
			{ value: '30', label: '30 min', phrase: '30 minuter' },
			{ value: '45', label: '45 min', phrase: '45 minuter' },
			{ value: '60', label: '60 min eller mer', phrase: '60 minuter eller mer' }
		]
	},
	{
		id: 'intensity',
		kind: 'radio',
		title: 'Hur tufft ska det vara?',
		options: [
			{ value: 'lugnt', label: 'Lugnt' },
			{ value: 'normalt', label: 'Normalt' },
			{ value: 'tufft', label: 'Tufft' }
		]
	},
	{
		id: 'warmup',
		kind: 'radio',
		title: 'Vill du ha uppvärmning och stretch?',
		options: [
			{ value: 'both', label: 'Ja, båda', phrase: 'Ta med både uppvärmning och stretch.' },
			{ value: 'warmup', label: 'Bara uppvärmning', phrase: 'Ta med uppvärmning men ingen stretch.' },
			{ value: 'stretch', label: 'Bara stretch', phrase: 'Ta med stretch men ingen uppvärmning.' },
			{ value: 'none', label: 'Nej', phrase: 'Ingen uppvärmning eller stretch.' }
		]
	},
	{
		id: 'place',
		kind: 'radio',
		title: 'Var tränar du, och med vad?',
		options: [
			{ value: 'gym', label: 'På gym', phrase: 'på gym' },
			{ value: 'hantlar', label: 'Hemma med hantlar', phrase: 'hemma med hantlar' },
			{ value: 'kroppsvikt', label: 'Bara kroppsvikt', phrase: 'bara med kroppsvikt' }
		],
		fact: 'place'
	},
	{
		id: 'experience',
		kind: 'radio',
		title: 'Hur van är du vid styrketräning?',
		options: [
			{ value: 'ny', label: 'Ny', phrase: 'ny på styrketräning' },
			{ value: 'en-del', label: 'Har tränat en del', phrase: 'har tränat en del' },
			{ value: 'van', label: 'Van', phrase: 'van vid styrketräning' }
		],
		fact: 'experience'
	},
	{
		id: 'avoid',
		kind: 'text',
		title: 'Har du skador, eller övningar du vill undvika?',
		hint: 'Till exempel ”ont i vänster knä, inga djupa knäböj”.',
		max: MAX_RULE,
		fact: 'avoid'
	},
	{ id: 'more', kind: 'text', title: 'Något mer Milon ska veta?', hint: 'Skriv fritt, eller hoppa över.', max: MAX_MORE }
];

/**
 * An answer: the chosen option values (with OTHER for "Annat…") and the
 * "Annat…" text. A text question has only `other`.
 */
export interface Answer {
	selected: string[];
	other: string;
}

export type Answers = Partial<Record<QuestionId, Answer>>;

/** What the profile already says about the user, from lines this questionnaire saved. */
export interface KnownFacts {
	place?: string;
	experience?: string;
	rules: string[];
}

/** The lines in `coachContext` that hold the saved answers. */
const PREFIX: Record<'place' | 'experience', string> = { place: 'Tränar: ', experience: 'Erfarenhet: ' };

/** One line of text: newlines and runs of spaces become one space. */
export function oneLine(text: string): string {
	return text.replace(/\s+/g, ' ').trim();
}

/** Swedish list: "a", "a och b", "a, b och c". */
function list(items: string[]): string {
	return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} och ${items[items.length - 1]}`;
}

/** Ends a sentence with a full stop unless it already ends with punctuation. */
function sentence(text: string): string {
	return /[.!?…]$/.test(text) ? text : `${text}.`;
}

export function knownFacts(profile: Profile): KnownFacts {
	const lines = (profile.coachContext ?? '').split('\n');
	const find = (prefix: string) => {
		const line = lines.find((l) => l.startsWith(prefix));
		const value = line && oneLine(line.slice(prefix.length));
		return value || undefined;
	};
	return { place: find(PREFIX.place), experience: find(PREFIX.experience), rules: (profile.rules ?? []).filter((r) => r.trim()) };
}

/**
 * The answer's text as it reads in the message: the option phrases and the
 * "Annat…" text. Empty when nothing is chosen or the "Annat…" text is empty.
 */
export function answerPhrases(question: Question, answer: Answer | undefined): string[] {
	if (!answer) return [];
	if (question.kind === 'text') {
		// A saved answer is one line, like the rule it becomes; "Något mer?" keeps its lines.
		const text = question.fact ? oneLine(answer.other) : answer.other.trim();
		return text ? [text] : [];
	}
	const phrases = question.options.filter((o) => answer.selected.includes(o.value)).map((o) => o.phrase ?? o.label.toLowerCase());
	const other = oneLine(answer.other);
	if (answer.selected.includes(OTHER) && other) phrases.push(other);
	return question.kind === 'radio' ? phrases.slice(0, 1) : phrases;
}

/** The answer to a profile question, as one line to save; undefined when there is none. */
export function factValue(question: Question, answer: Answer | undefined): string | undefined {
	return oneLine(answerPhrases(question, answer).join(', ')) || undefined;
}

/** Whether the profile already has this answer: the same `Tränar:`/`Erfarenhet:` line, or the same rule. */
export function isKnown(question: Question, value: string | undefined, known: KnownFacts): boolean {
	if (value === undefined) return false;
	if (question.fact === 'avoid') return known.rules.includes(value);
	return (question.fact === 'place' && value === known.place) || (question.fact === 'experience' && value === known.experience);
}

/** Answers read back from sessionStorage, or null if they don't have the expected shape. */
export function parseAnswers(v: unknown): Answers | null {
	if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
	const answers: Answers = {};
	for (const q of QUESTIONS) {
		const a = (v as Record<string, unknown>)[q.id] as Partial<Answer> | undefined;
		if (a === undefined) continue;
		if (!Array.isArray(a?.selected) || !a.selected.every((x) => typeof x === 'string') || typeof a.other !== 'string') return null;
		answers[q.id] = { selected: a.selected, other: a.other };
	}
	return answers;
}

/** An answer that preselects what the profile already says, or nothing. */
export function answerFromFact(question: Question, value: string | undefined): Answer | undefined {
	if (!value || question.kind !== 'radio') return undefined;
	const option = question.options.find((o) => (o.phrase ?? o.label.toLowerCase()) === value);
	return option ? { selected: [option.value], other: '' } : { selected: [OTHER], other: value };
}

/**
 * Puts the answers together into the first message to Milon. Skipped questions
 * are left out, and so is what Milon already knows from the profile.
 */
export function composeMessage(answers: Answers, known: KnownFacts): string {
	const lines: string[] = [];
	const phrases = (id: QuestionId) => answerPhrases(QUESTIONS.find((q) => q.id === id)!, answers[id]);

	const focus = phrases('focus');
	if (focus.length) lines.push(`Fokus: ${list(focus)}.`);
	const [time] = phrases('time');
	if (time) lines.push(sentence(`Tid: ${time}`));
	const [intensity] = phrases('intensity');
	if (intensity) lines.push(sentence(`Intensitet: ${intensity}`));
	const [warmup] = phrases('warmup');
	if (warmup) lines.push(answers.warmup?.selected.includes(OTHER) ? sentence(`Uppvärmning och stretch: ${warmup}`) : warmup);
	const [place] = phrases('place');
	if (place && place !== known.place) lines.push(sentence(`Jag tränar ${place}`));
	const [experience] = phrases('experience');
	if (experience && experience !== known.experience) lines.push(sentence(`Erfarenhet: ${experience}`));
	const [avoid] = phrases('avoid');
	if (avoid && !known.rules.includes(avoid)) lines.push(sentence(`Undvik: ${avoid}`));
	const [more] = phrases('more');
	if (more) lines.push(more);

	const message = ['Hej! Hjälp mig bygga ett nytt pass.', ...lines].join('\n');
	return Array.from(message).slice(0, MAX_MESSAGE).join('');
}

/** Answers to save, checked and trimmed. Messages are shown to the user. */
export type FactsToSave = Partial<Record<ProfileFact, string>>;

export class FactError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'FactError';
	}
}

/**
 * The profile with the saved answers: `Tränar:` and `Erfarenhet:` replace their
 * earlier line in `coachContext` (or are added), and the injuries become a rule
 * unless the same rule is already there. Throws FactError past the profile limits.
 */
export function withFacts(profile: Profile, facts: FactsToSave): Profile {
	const next: Profile = { ...profile };
	const lines = (profile.coachContext ?? '').trim().split('\n');
	for (const key of ['place', 'experience'] as const) {
		const value = facts[key] && oneLine(facts[key]);
		if (!value) continue;
		if (value.length > MAX_OTHER) throw new FactError('Svaret är för långt.');
		const i = lines.findIndex((l) => l.startsWith(PREFIX[key]));
		lines.splice(i < 0 ? lines.length : i, i < 0 ? 0 : 1, `${PREFIX[key]}${value}`);
	}
	const context = lines.join('\n').trim();
	if (context.length > MAX_GOALS) throw new FactError('Profilens text till Milon är full. Den kan inte ta fler svar.');
	if (context) next.coachContext = context;

	const avoid = facts.avoid && oneLine(facts.avoid);
	if (avoid) {
		if (avoid.length > MAX_RULE) throw new FactError(`Svaret om skador får vara högst ${MAX_RULE} tecken.`);
		const rules = profile.rules ?? [];
		if (!rules.includes(avoid)) {
			if (rules.length >= MAX_RULES) throw new FactError(`Profilen har redan ${MAX_RULES} regler. Det går inte att spara fler.`);
			next.rules = [...rules, avoid];
		}
	}
	return next;
}
