import { describe, expect, it } from 'vitest';
import { moveWithinPhase } from './move';

const list = [
	{ id: 'w', phase: 'warmup' as const },
	{ id: 'a' },
	{ id: 'b' },
	{ id: 'c', phase: 'main' as const },
	{ id: 's', phase: 'cooldown' as const }
];
const ids = (l: { id: string }[] | null) => l?.map((x) => x.id) ?? null;

describe('moveWithinPhase', () => {
	it('moves an item up or down within its part, without touching the original', () => {
		expect(ids(moveWithinPhase(list, 1, 3))).toEqual(['w', 'b', 'c', 'a', 's']);
		expect(ids(moveWithinPhase(list, 3, 1))).toEqual(['w', 'c', 'a', 'b', 's']);
		expect(ids(list)).toEqual(['w', 'a', 'b', 'c', 's']);
	});

	it('never moves an item into another part or outside the list', () => {
		expect(moveWithinPhase(list, 1, 0)).toBeNull();
		expect(moveWithinPhase(list, 3, 4)).toBeNull();
		expect(moveWithinPhase(list, 4, 5)).toBeNull();
		expect(moveWithinPhase(list, -1, 1)).toBeNull();
		expect(moveWithinPhase(list, 2, 2)).toBeNull();
	});
});
