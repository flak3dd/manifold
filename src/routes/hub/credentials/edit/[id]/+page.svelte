<script lang="ts">
  import { page } from '$app/stores';
  import { hubCredentialsStore } from '$lib/hub/stores/credentials';

  const id = $derived($page.params.id ?? '');
  let cred = $derived(hubCredentialsStore.getById(id));
  let username = $state('');
  let password = $state('');
  let cardNumber = $state('');
  let cardExpiryMonth = $state('');
  let cardExpiryYear = $state('');
  let cardCVV = $state('');

  $effect(() => {
    if (cred) {
      username = cred.username;
      password = hubCredentialsStore.getPassword(cred.id) ?? '';
      cardNumber = hubCredentialsStore.getCardNumber(cred.id) ?? '';
      cardExpiryMonth = cred.cardExpiryMonth ?? '';
      cardExpiryYear = cred.cardExpiryYear ?? '';
      cardCVV = hubCredentialsStore.getCardCVV(cred.id) ?? '';
    }
  });

  function save() {
    if (!cred) return;
    hubCredentialsStore.update(cred.id, { username: username.trim(), password: password || undefined, cardNumber: cardNumber.trim() || undefined, cardExpiryMonth: cardExpiryMonth.trim() || undefined, cardExpiryYear: cardExpiryYear.trim() || undefined, cardCVV: cardCVV || undefined });
    window.history.back();
  }
</script>

{#if !cred}
  <p>Not found.</p>
  <a href="/hub/credentials">Back</a>
{:else}
  <div class="hub-page">
    <h1>Edit Credential</h1>
    <form onsubmit={(e) => { e.preventDefault(); save(); }}>
      <label for="edit-cred-username">Username</label>
      <input id="edit-cred-username" type="text" bind:value={username} />
      <label for="edit-cred-password">Password</label>
      <input id="edit-cred-password" type="password" bind:value={password} />
      <label for="edit-cred-card">Card</label>
      <input id="edit-cred-card" type="text" bind:value={cardNumber} />
      <div class="row">
        <input type="text" bind:value={cardExpiryMonth} placeholder="MM" />
        <input type="text" bind:value={cardExpiryYear} placeholder="YY" />
        <input type="password" bind:value={cardCVV} placeholder="CVV" />
      </div>
      <div class="form-actions">
        <a href="/hub/credentials">Cancel</a>
        <button type="submit">Save</button>
      </div>
    </form>
  </div>
{/if}

<style>
  label { display: block; margin-top: 0.75rem; }
  input { width: 100%; padding: 0.5rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-3); color: var(--text-primary); }
  .row { display: flex; gap: 0.5rem; }
  .form-actions { margin-top: 1rem; display: flex; gap: 0.5rem; }
  .form-actions button { padding: 0.5rem 1rem; background: var(--accent); color: var(--bg); border: none; border-radius: var(--radius); cursor: pointer; }
</style>
