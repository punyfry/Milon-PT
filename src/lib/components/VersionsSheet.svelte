<script lang="ts">
	/** The versions of a workout, newest first, where an older one can be restored as the next version. */
	import Sheet from './Sheet.svelte';

	interface Props {
		name: string;
		versions: { version: number; createdAt: string; changeNote: string | null; exerciseCount: number }[];
		onrestore: (version: number) => void;
		onclose: () => void;
		/** Why the latest restore failed, shown in the sheet. */
		failure?: string | null;
	}
	let { name, versions, onrestore, onclose, failure = null }: Props = $props();
</script>

<Sheet title="Versioner" {onclose}>
	<h2>Versioner av {name}</h2>
	<p class="muted">Att återställa en äldre version sparar den som en ny version.</p>
	{#if failure}<p class="error" role="alert">{failure}</p>{/if}
	<ul class="versions">
		{#each versions as v, i (v.version)}
			<li>
				<div>
					<strong class="num">v{v.version}</strong>
					<span class="muted">{v.createdAt} · {v.exerciseCount} övningar</span>
					{#if v.changeNote}<div class="muted note">{v.changeNote}</div>{/if}
				</div>
				{#if i > 0}
					<button class="btn small" onclick={() => onrestore(v.version)}>Återställ</button>
				{:else}
					<span class="tag quiet">Aktuell</span>
				{/if}
			</li>
		{/each}
	</ul>
	<button class="btn ghost full" onclick={onclose}>Stäng</button>
</Sheet>

<style>
	.versions {
		list-style: none;
		margin: 0;
		padding: 0;
	}
	.versions li {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		padding: 12px 0;
		border-bottom: 1px solid var(--line);
	}
	.versions li > div {
		display: grid;
		gap: 2px;
		font-size: 14px;
	}
	.note {
		font-size: 13px;
	}
</style>
