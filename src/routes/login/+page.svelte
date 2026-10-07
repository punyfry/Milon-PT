<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const messages: Record<string, string> = {
		AccessDenied: 'Kontot har inte behörighet till Milon-PT.',
		Configuration: 'Inloggningen är felkonfigurerad. Kontrollera miljövariablerna.'
	};
</script>

<svelte:head><title>Logga in · Milon-PT</title></svelte:head>

<main class="login">
	<h1 class="mark">Milon<span>.</span></h1>
	<p>Din träningslogg. Coachen finns här när du frågar.</p>
	{#if data.error}
		<p class="error" role="alert">{messages[data.error] ?? 'Inloggningen misslyckades. Försök igen.'}</p>
	{/if}
	<form method="POST">
		<input type="hidden" name="providerId" value="google" />
		<input type="hidden" name="redirectTo" value="/" />
		<button type="submit" class="btn primary full">Logga in med Google</button>
	</form>
</main>

<style>
	.login {
		min-height: 100dvh;
		display: grid;
		align-content: center;
		gap: 14px;
		padding-inline: 28px;
		padding-bottom: 60px;
	}
	.mark {
		font-size: 64px;
		font-weight: 600;
		letter-spacing: 0.005em;
		line-height: 1;
		color: var(--heading);
	}
	.mark span {
		color: var(--accent);
	}
	p {
		margin: 0;
		color: var(--soft);
		font-size: 17px;
		max-width: 26ch;
	}
	p.error {
		color: var(--danger);
		font-size: 15px;
	}
	form {
		margin-top: 24px;
	}
</style>
