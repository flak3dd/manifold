<script lang="ts">
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  // Scanner is merged into Hub Setup (/hub).
  onMount(() => goto('/hub'));
</script>

<p>Redirecting to Hub Setup…</p>
