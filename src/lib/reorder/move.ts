import { phaseOf, type Phase } from '$lib/model';

/**
 * Moves the item at `from` to `to` in a copy of the list. A workout's list is
 * kept in parts (warm-up, main, stretch), so an item only moves within its own
 * part: returns null when `to` is in another part or outside the list.
 */
export function moveWithinPhase<T extends { phase?: Phase }>(list: readonly T[], from: number, to: number): T[] | null {
	if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return null;
	if (phaseOf(list[from]) !== phaseOf(list[to])) return null;
	const next = [...list];
	const [item] = next.splice(from, 1);
	next.splice(to, 0, item);
	return next;
}
