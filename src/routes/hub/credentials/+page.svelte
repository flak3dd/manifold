<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  // Credentials are merged into Hub Setup (/hub).
  onMount(() => goto('/hub'));
</script>

<p>Redirecting to Hub Setup…</p>
