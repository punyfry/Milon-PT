<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	const messages: Record<string, string> = {
		AccessDenied: 'Kontot har inte behörighet till Milon-PT.',
		Configuration: 'Inloggningen är felkonfigurerad. Kontrollera miljövariablerna.'
	};
</script>

<main>
	<h1>Milon-PT</h1>
	{#if data.error}
		<p class="error">{messages[data.error] ?? 'Inloggningen misslyckades.'}</p>
	{/if}
	<form method="POST">
		<input type="hidden" name="providerId" value="google" />
		<input type="hidden" name="redirectTo" value="/" />
		<button type="submit">Logga in med Google</button>
	</form>
</main>
