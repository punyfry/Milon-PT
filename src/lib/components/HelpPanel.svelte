<script lang="ts">
	interface Props {
		name: string;
		log: { role: 'user' | 'assistant' | 'event'; text: string }[];
		busy: boolean;
		error: string | null;
		/** "Byt övning" is only shown if the exercise is not already swapped in. */
		canSwap: boolean;
		onask: (question: string) => void;
		onclose: () => void;
	}

	let { name, log, busy, error, canSwap, onask, onclose }: Props = $props();
	let input = $state('');

	function submit(e: SubmitEvent) {
		e.preventDefault();
		const q = input.trim();
		if (!q || busy) return;
		input = '';
		onask(q);
	}
</script>

<div class="head">
	<h2>Fråga Milon</h2>
	<button type="button" class="icon-btn" onclick={onclose} aria-label="Stäng">
		<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
	</button>
</div>
<p class="muted intro">Om {name}. Milon svarar bara på det du frågar.</p>

{#if log.length || busy || error}
	<div class="log" aria-live="polite">
		{#each log as item, i (i)}
			<p class="msg {item.role}">{item.text}</p>
		{/each}
		{#if busy}<p class="msg assistant typing">Milon tänker…</p>{/if}
		{#if error}<p class="msg error" role="alert">{error}</p>{/if}
	</div>
{/if}

<div class="quick">
	<button type="button" class="btn small" disabled={busy} onclick={() => onask(`Ge mig mer instruktion för ${name}.`)}>Mer instruktion</button>
	{#if canSwap}
		<button type="button" class="btn small" disabled={busy} onclick={() => onask(`Jag vill byta ut ${name}. Vad kan jag göra i stället?`)}>Byt övning</button>
	{/if}
</div>

<form onsubmit={submit}>
	<input bind:value={input} maxlength="500" placeholder="Fråga om {name}…" aria-label="Fråga till Milon" enterkeyhint="send" disabled={busy} />
	<button type="submit" class="btn" disabled={busy || !input.trim()}>Skicka</button>
</form>

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
	svg {
		fill: none;
		stroke: currentColor;
		stroke-width: 1.75;
		stroke-linecap: round;
	}
	.intro {
		margin: 0;
	}
	.log {
		display: grid;
		gap: 10px;
	}
	.msg {
		margin: 0;
		padding: 10px 14px;
		border-radius: 14px;
		max-width: 88%;
		white-space: pre-line;
		font-size: 15px;
	}
	.msg.user {
		justify-self: end;
		background: var(--surface-2);
		box-shadow: inset 0 0 0 1px var(--ring);
	}
	.msg.assistant {
		justify-self: start;
		border: 1px solid var(--line);
	}
	.msg.event {
		justify-self: center;
		padding: 4px 0;
		font-size: 13px;
		font-weight: 500;
		color: var(--accent);
	}
	.msg.error {
		justify-self: center;
		color: var(--danger);
		font-size: 14px;
	}
	.typing {
		color: var(--muted);
		font-style: italic;
	}
	.quick {
		display: flex;
		gap: 8px;
		flex-wrap: wrap;
	}
	form {
		display: flex;
		gap: 8px;
	}
	input {
		flex: 1;
		min-width: 0;
		min-height: 48px;
		border-radius: 14px;
		border: 0;
		background: var(--surface-2);
		padding: 0 14px;
	}
</style>
