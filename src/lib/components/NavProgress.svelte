<script lang="ts">
	import { navigating } from '$app/state';
</script>

<!--
	Thin bar at the top while the next view loads. It appears after a short
	delay so quick navigations don't flash.
-->
{#if navigating.to}
	<div class="bar" role="progressbar" aria-label="Laddar"></div>
{/if}

<style>
	.bar {
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		z-index: 20;
		height: 3px;
		padding-top: env(safe-area-inset-top, 0px);
		background: linear-gradient(90deg, transparent, var(--accent), transparent) no-repeat;
		background-size: 40% 3px;
		background-position-y: bottom;
		opacity: 0;
		animation:
			show 0s linear 120ms forwards,
			slide 1.1s ease-in-out 120ms infinite;
	}
	@keyframes show {
		to {
			opacity: 1;
		}
	}
	@keyframes slide {
		from {
			background-position-x: -60%;
		}
		to {
			background-position-x: 160%;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.bar {
			background: linear-gradient(var(--accent), var(--accent)) no-repeat bottom / 100% 3px;
			animation: show 0s linear 120ms forwards;
		}
	}
</style>
