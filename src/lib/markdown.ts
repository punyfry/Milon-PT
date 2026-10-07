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
	| { type: 'ul' | 'ol'; items: Line[] };

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

export function parseMarkdown(text: string): Block[] {
	const blocks: Block[] = [];
	let current = null as Block | null;
	const flush = () => {
		if (current) blocks.push(current);
		current = null;
	};

	for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
		if (!raw.trim()) {
			flush();
			continue;
		}
		const heading = HEADING.exec(raw);
		const bullet = BULLET.exec(raw);
		const numbered = NUMBERED.exec(raw);
		if (heading) {
			flush();
			blocks.push({ type: 'heading', line: parseInline(heading[1]) });
		} else if (bullet || numbered) {
			const type = bullet ? 'ul' : 'ol';
			const item = parseInline((bullet ?? numbered)![1]);
			if (current?.type === type) current.items.push(item);
			else {
				flush();
				current = { type, items: [item] };
			}
		} else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(raw)) {
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
	const re = /`([^`]+)`|\*\*(.+?)\*\*(?!\*)|__(.+?)__|\*(?!\s)([^*]+?)\*|(?<![\p{L}\p{N}])_(?!\s)([^_]+?)_(?![\p{L}\p{N}])/gu;
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
