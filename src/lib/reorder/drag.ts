import type { Action } from 'svelte/action';

export interface DragParams {
	/** The row's index in the whole list. */
	index: number;
	/** Moves the row; returns false when it can't go there (e.g. another part of the workout). */
	onmove: (from: number, to: number) => boolean;
	/** The drag started (true) or ended (false). */
	ondrag?: (active: boolean) => void;
}

/**
 * Drag to reorder, on a row's handle. The rows are the elements with
 * `data-sort-index` inside the closest `[data-sortable]`, and the list is
 * reordered live while the finger moves. Listens on the window, since the
 * row (and the handle) moves in the DOM during the drag. The handle needs
 * `touch-action: none` so the page doesn't scroll instead; up and down
 * buttons are the alternative for keyboards and screen readers.
 */
export const dragHandle: Action<HTMLElement, DragParams> = (node, initial) => {
	let params = initial;
	let current = -1;
	let pointer: number | null = null;

	function rowAt(y: number): number | null {
		const rows = [...(node.closest('[data-sortable]')?.querySelectorAll<HTMLElement>('[data-sort-index]') ?? [])];
		if (!rows.length) return null;
		for (const row of rows) {
			const rect = row.getBoundingClientRect();
			if (y < rect.bottom) return Number(row.dataset.sortIndex);
		}
		return Number(rows[rows.length - 1].dataset.sortIndex);
	}

	function move(e: PointerEvent) {
		if (e.pointerId !== pointer) return;
		e.preventDefault();
		const to = rowAt(e.clientY);
		if (to === null || to === current) return;
		if (params.onmove(current, to)) current = to;
	}

	function end(e: PointerEvent) {
		if (e.pointerId !== pointer) return;
		pointer = null;
		removeEventListener('pointermove', move);
		removeEventListener('pointerup', end);
		removeEventListener('pointercancel', end);
		params.ondrag?.(false);
	}

	function start(e: PointerEvent) {
		if (e.button !== 0 || pointer !== null) return;
		e.preventDefault();
		pointer = e.pointerId;
		current = params.index;
		addEventListener('pointermove', move, { passive: false });
		addEventListener('pointerup', end);
		addEventListener('pointercancel', end);
		params.ondrag?.(true);
	}

	node.addEventListener('pointerdown', start);
	return {
		update(next) {
			params = next;
		},
		destroy() {
			node.removeEventListener('pointerdown', start);
			removeEventListener('pointermove', move);
			removeEventListener('pointerup', end);
			removeEventListener('pointercancel', end);
		}
	};
};
