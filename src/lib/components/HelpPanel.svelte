<script lang="ts">
	interface Props {
		name: string;
		log: { role: 'user' | 'assistant' | 'event'; text: string }[];
		busy: boolean;
		error: string | null;
		onask: (question: string) => void;
		onclose: () => void;
	}

	let { name, log, busy, error, onask, onclose }: Props = $props();
	let input = $state('');

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const q = input.trim();
		if (!q || busy) return;
		input = '';
		onask(q);
	}
</script>

<div class="panel" role="region" aria-label="Hjälp med {name}">
	<div class="head">
		<strong>Fråga Milon</strong>
		<button type="button" class="close" onclick={onclose} aria-label="Stäng hjälpen">×</button>
	</div>

	{#if !log.length}
		<div class="quick">
			<button type="button" disabled={busy} onclick={() => onask(`Ge mig mer instruktion för ${name}.`)}>Mer instruktion</button>
			<button type="button" disabled={busy} onclick={() => onask(`Jag vill byta ut ${name}. Vad kan jag göra i stället?`)}>Byt övning</button>
		</div>
	{/if}

	<div class="log" aria-live="polite">
		{#each log as item, i (i)}
			<p class="msg {item.role}">{item.text}</p>
		{/each}
		{#if busy}<p class="msg assistant typing">Milon tänker…</p>{/if}
		{#if error}<p class="msg error" role="alert">{error}</p>{/if}
	</div>

	<form onsubmit={submit}>
		<input bind:value={input} maxlength="500" placeholder="Fråga om {name}…" aria-label="Fråga till Milon" disabled={busy} />
		<button type="submit" disabled={busy || !input.trim()}>Skicka</button>
	</form>
</div>

<style>
	.panel {
		margin: 0.25rem 0.25rem 0.75rem;
		padding: 0.75rem;
		border-radius: 12px;
		background: var(--bg);
		border: 1px solid var(--border);
	}
	.head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		margin-bottom: 0.5rem;
	}
	.close {
		background: none;
		border: none;
		font-size: 1.3rem;
		color: var(--muted);
		cursor: pointer;
		padding: 0 0.25rem;
	}
	.quick {
		display: flex;
		gap: 0.5rem;
		flex-wrap: wrap;
		margin-bottom: 0.5rem;
	}
	.quick button,
	form button {
		padding: 0.5rem 0.8rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
		cursor: pointer;
	}
	.log {
		display: grid;
		gap: 0.4rem;
	}
	.msg {
		margin: 0;
		white-space: pre-line;
		font-size: 0.95rem;
	}
	.msg.user {
		color: var(--muted);
		text-align: right;
	}
	.msg.event {
		color: var(--accent);
		font-weight: 600;
	}
	.msg.error {
		color: var(--danger);
	}
	.typing {
		color: var(--muted);
		font-style: italic;
	}
	form {
		display: flex;
		gap: 0.5rem;
		margin-top: 0.6rem;
	}
	input {
		flex: 1;
		min-width: 0;
		font: inherit;
		padding: 0.5rem 0.7rem;
		border-radius: 10px;
		border: 1px solid var(--border);
		background: var(--surface);
		color: var(--text);
	}
	button:disabled {
		opacity: 0.5;
		cursor: default;
	}
</style>
