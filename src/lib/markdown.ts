/**
 * Enkel markdown för chattsvar: stycken, radbrytningar, punkt- och
 * numrerade listor, rubriker (visas som fet rad), **fet**, *kursiv* och
 * `kod`. Resultatet är data som renderas som vanliga element, aldrig HTML,
 * så modellens text kan inte injicera något.
 */

export interface Span {
	text: string;
	bold?: boolean;
	italic?: boolean;
	code?: boolean;
}

/** En rad text. */
export type Line = Span[];

export type Block =
	| { type: 'p'; lines: Line[] }
	| { type: 'heading'; line: Line }
	| { type: 'ul'; items: Line[] }
	| { type: 'ol'; items: Line[]; start: number };

const BULLET = /^\s*[-*•]\s+(\S.*)$/;
const RULE = /^\s*([-*_])(\s*\1){2,}\s*$/;
const NUMBERED = /^\s*(\d{1,3})[.)]\s+(\S.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

export function parseMarkdown(text: string): Block[] {
	const blocks: Block[] = [];
	let current = null as Block | null;
	/** Tom rad efter en lista: listan fortsätter bara om nästa rad är en punkt av samma slag. */
	let gap = false;
	const flush = () => {
		if (current) blocks.push(current);
		current = null;
	};

	for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
		if (!raw.trim()) {
			if (current?.type === 'ul' || current?.type === 'ol') gap = true;
			else flush();
			continue;
		}
		const rule = RULE.test(raw);
		const heading = HEADING.exec(raw);
		const bullet = rule ? null : BULLET.exec(raw);
		const numbered = NUMBERED.exec(raw);
		const isList = current?.type === 'ul' || current?.type === 'ol';
		if (gap && !(isList && ((bullet && current!.type === 'ul') || (numbered && current!.type === 'ol')))) flush();
		const wasGap = gap;
		gap = false;
		if (heading) {
			flush();
			blocks.push({ type: 'heading', line: parseInline(heading[1]) });
		} else if (bullet) {
			const item = parseInline(bullet[1]);
			if (current?.type === 'ul') current.items.push(item);
			else {
				flush();
				current = { type: 'ul', items: [item] };
			}
		} else if (numbered) {
			const item = parseInline(numbered[2]);
			if (current?.type === 'ol') current.items.push(item);
			else {
				flush();
				current = { type: 'ol', items: [item], start: Number(numbered[1]) };
			}
		} else if (!wasGap && (current?.type === 'ul' || current?.type === 'ol') && /^\s+\S/.test(raw)) {
			// Indragen fortsättningsrad hör till föregående punkt.
			const last = current.items[current.items.length - 1];
			last.push({ text: ' ' }, ...parseInline(raw.trim()));
		} else if (rule) {
			flush();
		} else if (current?.type === 'p') {
			current.lines.push(parseInline(raw));
		} else {
			flush();
			current = { type: 'p', lines: [parseInline(raw)] };
		}
	}
	flush();
	return blocks;
}

/** **fet**, __fet__, *kursiv*, _kursiv_ och `kod`. Omatchade tecken visas som de är. */
export function parseInline(text: string): Line {
	const spans: Line = [];
	const re = /`([^`]+)`|\*\*(.+?)\*\*(?!\*)|__(.+?)__|(?<![\p{L}\p{N}*])\*(?!\s)([^*]+?)(?<!\s)\*(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])_(?!\s)([^_]+?)(?<!\s)_(?![\p{L}\p{N}])/gu;
	let last = 0;
	for (const m of text.matchAll(re)) {
		if (m.index > last) spans.push({ text: text.slice(last, m.index) });
		if (m[1] !== undefined) spans.push({ text: m[1], code: true });
		else if (m[2] !== undefined || m[3] !== undefined) {
			for (const inner of parseInline(m[2] ?? m[3])) spans.push({ ...inner, bold: true });
		} else for (const inner of parseInline(m[4] ?? m[5])) spans.push({ ...inner, italic: true });
		last = m.index + m[0].length;
	}
	if (last < text.length) spans.push({ text: text.slice(last) });
	return spans;
}
