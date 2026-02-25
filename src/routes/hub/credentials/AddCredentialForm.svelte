<script lang="ts">
  import { hubCredentialsStore } from '$lib/hub/stores/credentials';

  let { onClose, onSaved } = $props();
  let username = $state('');
  let password = $state('');
  let cardNumber = $state('');
  let cardExpiryMonth = $state('');
  let cardExpiryYear = $state('');
  let cardCVV = $state('');

  function save() {
    if (!username.trim() || !password) return;
    hubCredentialsStore.add({
      username: username.trim(),
      password,
      cardNumber: cardNumber.trim() || undefined,
      cardExpiryMonth: cardExpiryMonth.trim() || undefined,
      cardExpiryYear: cardExpiryYear.trim() || undefined,
      cardCVV: cardCVV || undefined,
    });
    onSaved();
  }
</script>

<div
  class="modal-overlay"
  onclick={onClose}
  onkeydown={(e) => e.key === 'Escape' && onClose()}
  role="presentation"
  tabindex="-1"
>
  <div
    class="modal"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
    role="dialog"
    tabindex="-1"
  >
    <h2>Add Credential</h2>
    <form onsubmit={(e) => { e.preventDefault(); save(); }}>
      <label for="add-cred-username">Username / Email</label>
      <input id="add-cred-username" type="text" bind:value={username} />
      <label for="add-cred-password">Password</label>
      <input id="add-cred-password" type="password" bind:value={password} />
      <label for="add-cred-card">Card (optional)</label>
      <input id="add-cred-card" type="text" bind:value={cardNumber} placeholder="Number" />
      <div class="row">
        <input type="text" bind:value={cardExpiryMonth} placeholder="MM" />
        <input type="text" bind:value={cardExpiryYear} placeholder="YY" />
        <input type="password" bind:value={cardCVV} placeholder="CVV" />
      </div>
      <div class="modal-actions">
        <button type="button" onclick={onClose}>Cancel</button>
        <button type="submit" disabled={!username.trim() || !password}>Save</button>
      </div>
    </form>
  </div>
</div>

<style>
  .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 100; }
  .modal { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 1.5rem; min-width: 320px; }
  .modal h2 { margin-bottom: 1rem; color: var(--text-primary); }
  label { display: block; margin-top: 0.75rem; margin-bottom: 0.25rem; font-size: 0.8125rem; color: var(--text-secondary); }
  input { width: 100%; padding: 0.5rem; border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface-3); color: var(--text-primary); }
  .row { display: flex; gap: 0.5rem; }
  .row input { flex: 1; }
  .modal-actions { margin-top: 1.25rem; display: flex; gap: 0.5rem; justify-content: flex-end; }
  .modal-actions button { padding: 0.5rem 1rem; border-radius: var(--radius); border: 1px solid var(--border); background: var(--surface-3); color: var(--text-primary); cursor: pointer; }
  .modal-actions button[type="submit"] { background: var(--accent); color: var(--bg); border-color: var(--accent); }
</style>
