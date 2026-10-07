/**
 * Simple markdown for chat replies: paragraphs, line breaks, bulleted and
 * numbered lists, headings (shown as a bold line), **bold**, *italic* and
 * `code`. The result is data rendered as plain elements, never HTML, so the
 * model's text cannot inject anything.
 */

export interface Span {
	text: string;
	bold?: boolean;
	italic?: boolean;
	code?: boolean;
}

/** A line of text. */
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
	/** Blank line after a list: the list only continues if the next line is an item of the same kind. */
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
			// An indented continuation line belongs to the previous item.
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

/** **bold**, __bold__, *italic*, _italic_ and `code`. Unmatched characters are shown as is. */
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
