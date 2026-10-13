<script lang="ts">
	/** The versions of a workout, newest first, where an older one can be restored as the next version. */
	import Sheet from './Sheet.svelte';

	interface Props {
		slug: string;
		name: string;
		versions: { version: number; createdAt: string; changeNote: string | null; exerciseCount: number }[];
		/** Called after a restore was saved. */
		onrestored: () => void | Promise<void>;
		onclose: () => void;
	}
	let { slug, name, versions, onrestored, onclose }: Props = $props();

	/** Why the latest restore failed, and the version it can be retried without the conflicting exercises, if any. */
	let failure = $state<{ message: string; skippable: number | null } | null>(null);
	let busy = $state(false);

	async function restore(version: number, skipConflicts = false) {
		const question = skipConflicts
			? `Återställa version ${version} utan de övningarna? Den sparas som en ny version.`
			: `Återställa version ${version}? Den sparas som en ny version.`;
		if (busy || !confirm(question)) return;
		failure = null;
		busy = true;
		try {
			const res = await fetch(`/api/workouts/${slug}/restore`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(skipConflicts ? { version, skipConflicts } : { version })
			});
			if (!res.ok) {
				const body = await res.json().catch(() => null);
				failure =
					res.status === 409 && typeof body?.message === 'string'
						? { message: body.message, skippable: body.skippable === true ? version : null }
						: { message: 'Kunde inte återställa versionen.', skippable: null };
				return;
			}
		} catch {
			failure = { message: 'Kunde inte nå servern. Försök igen.', skippable: null };
			return;
		} finally {
			busy = false;
		}
		await onrestored();
	}
</script>

<Sheet title="Versioner" {onclose}>
	<h2>Versioner av {name}</h2>
	<p class="muted">Att återställa en äldre version sparar den som en ny version.</p>
	{#if failure}
		<div class="failure" role="alert">
			<p class="error">{failure.message}</p>
			{#if failure.skippable !== null}
				{@const version = failure.skippable}
				<button class="btn small" disabled={busy} onclick={() => restore(version, true)}>Återställ v{version} utan dem</button>
			{/if}
		</div>
	{/if}
	<ul class="versions">
		{#each versions as v, i (v.version)}
			<li>
				<div>
					<strong class="num">v{v.version}</strong>
					<span class="muted">{v.createdAt} · {v.exerciseCount} övningar</span>
					{#if v.changeNote}<div class="muted note">{v.changeNote}</div>{/if}
				</div>
				{#if i > 0}
					<button class="btn small" disabled={busy} onclick={() => restore(v.version)}>Återställ</button>
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
	.failure {
		display: grid;
		gap: 8px;
		justify-items: start;
		margin-bottom: 8px;
	}
	.failure .error {
		margin: 0;
	}
</style>
