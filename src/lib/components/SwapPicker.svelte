<script lang="ts">
	/**
	 * Picks an exercise to swap to, from the user's own exercises. Used in the
	 * overview before a workout and during it. Milon can suggest variants or
	 * new exercises instead (`onaskmilon`).
	 */
	import { formatSet } from '$lib/format';
	import type { ActiveSession, ExerciseType } from '$lib/model';
	import { swapCandidates, type ExerciseInfo } from '$lib/session/active';
	import Icon from './Icon.svelte';

	interface Props {
		/** The exercise being swapped out. */
		name: string;
		type: ExerciseType | undefined;
		catalog: readonly ExerciseInfo[];
		session: ActiveSession;
		/** Shown when the helper is available. */
		onaskmilon?: () => void;
		onpick: (to: ExerciseInfo) => void;
		onclose: () => void;
	}

	let { name, type, catalog, session, onaskmilon, onpick, onclose }: Props = $props();
	let query = $state('');
	const candidates = $derived(swapCandidates(catalog, session, type, query));

	const TYPE_LABEL: Record<ExerciseType, string> = { weight: 'Vikt', bodyweight: 'Kroppsvikt', time: 'Tid' };

	function last(e: ExerciseInfo): string | null {
		const s = e.lastEntry?.sets[0];
		return s ? `förra ${formatSet(e.type, s)}` : null;
	}
</script>

<div class="head">
	<h2>Byt {name}</h2>
	<button type="button" class="icon-btn" onclick={onclose} aria-label="Stäng"><Icon name="x" /></button>
</div>
<p class="muted intro">Bytet gäller bara det här passet. När du avslutar kan du välja att spara det i passet.</p>

{#if onaskmilon}
	<button type="button" class="btn full" onclick={onaskmilon}><Icon name="chat" /> Fråga Milon om varianter eller nya övningar</button>
{/if}

<input type="search" bind:value={query} placeholder="Sök bland dina övningar" aria-label="Sök övning" enterkeyhint="search" />

{#if candidates.length}
	<ul class="list">
		{#each candidates as c (c.id)}
			{@const meta = last(c)}
			<li>
				<button type="button" class="row" onclick={() => onpick(c)}>
					<span class="name">{c.name}</span>
					<span class="meta">
						{#if c.type !== type}{TYPE_LABEL[c.type]}{/if}{#if c.type !== type && meta}&nbsp;·&nbsp;{/if}{#if meta}<span class="num">{meta}</span>{/if}
					</span>
				</button>
			</li>
		{/each}
	</ul>
{:else}
	<p class="muted">{query.trim() ? `Ingen övning matchar "${query.trim()}".` : 'Inga andra övningar finns än.'}</p>
{/if}

<style>
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
	}
	h2 {
		font-size: 20px;
		font-weight: 600;
	}
	.intro {
		font-size: 14px;
	}
	input {
		width: 100%;
		min-height: 48px;
		padding: 0 14px;
		border-radius: var(--radius);
		border: 1px solid var(--line);
		background: var(--surface-2);
		color: var(--text);
		font: inherit;
	}
	.list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
	}
	.row {
		width: 100%;
		min-height: 56px;
		display: grid;
		gap: 2px;
		text-align: left;
		padding: 8px 2px;
		background: none;
		border: 0;
		border-bottom: 1px solid var(--line);
		color: var(--text);
		font: inherit;
		cursor: pointer;
	}
	.name {
		font-weight: 500;
	}
	.meta {
		font-size: 13px;
		color: var(--muted);
	}
</style>
