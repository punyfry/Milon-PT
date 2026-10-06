<script lang="ts">
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();

	let storageStatus = $state<string | null>(null);

	async function testStorage() {
		storageStatus = 'Testar…';
		const res = await fetch('/api/storage/selftest', { method: 'POST' });
		const body = await res.json().catch(() => null);
		storageStatus = res.ok ? `OK: ${JSON.stringify(body)}` : `Fel ${res.status}: ${body?.message ?? ''}`;
	}
</script>

<main>
	<h1>Milon-PT</h1>
	<p>Inloggad som {data.user?.name ?? data.user?.email}</p>

	<button onclick={testStorage}>Testa lagring</button>
	{#if storageStatus}<pre>{storageStatus}</pre>{/if}

	<form method="POST" action="/signout">
		<input type="hidden" name="redirectTo" value="/login" />
		<button type="submit">Logga ut</button>
	</form>
</main>
