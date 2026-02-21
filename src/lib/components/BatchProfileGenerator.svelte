<script lang="ts">
	import {
		generateRandomProfiles,
		generateRandomProfilesAsync,
		generateRandomProfilesWithPattern,
		exportProfilesToJson,
		type RandomProfileGeneratorOptions,
		type GeneratedProfile,
	} from "$lib/utils/profile-generator";
	import { profileStore } from "$lib/stores/profiles.svelte";

	let {
		onClose,
		onProfilesGenerated,
	}: {
		onClose: () => void;
		onProfilesGenerated?: (profiles: GeneratedProfile[]) => void;
	} = $props();

	// State
	let count = $state(10);
	let useAutoNames = $state(true);
	let useCustomPattern = $state(false);
	let customPattern = $state("profile-{index1}");
	let selectedProxies = $state<string[]>([]);
	let useSeed = $state(false);
	let seedValue = $state("");
	let isGenerating = $state(false);
	let generationProgress = $state(0);
	let generatedProfiles = $state<GeneratedProfile[]>([]);
	let showResults = $state(false);
	let errorMsg = $state("");
	let successMsg = $state("");
	let proxyList = $state<Array<{ id: string; name: string }>>([]);
	let isSaving = $state(false);

	// Load available proxies
	async function loadProxies() {
		try {
			const proxies = await profileStore.loadProxies();
			proxyList = proxies.map((p) => ({
				id: p.id,
				name: p.name || p.server,
			}));
		} catch (e) {
			console.error("Failed to load proxies:", e);
			proxyList = [];
		}
	}

	// Toggle proxy selection
	function toggleProxy(proxyId: string) {
		const idx = selectedProxies.indexOf(proxyId);
		if (idx > -1) {
			selectedProxies = selectedProxies.filter((id) => id !== proxyId);
		} else {
			selectedProxies = [...selectedProxies, proxyId];
		}
	}

	// Select/deselect all proxies
	function toggleAllProxies() {
		if (selectedProxies.length === proxyList.length) {
			selectedProxies = [];
		} else {
			selectedProxies = proxyList.map((p) => p.id);
		}
	}

	// Generate profiles
	async function handleGenerate() {
		errorMsg = "";
		successMsg = "";

		if (count < 1 || count > 10000) {
			errorMsg = "Count must be between 1 and 10,000";
			return;
		}

		if (useCustomPattern && !customPattern.trim()) {
			errorMsg = "Custom pattern cannot be empty";
			return;
		}

		isGenerating = true;
		generationProgress = 0;

		try {
			let profiles: GeneratedProfile[];

			if (useCustomPattern) {
				// Use custom pattern
				const pattern = customPattern.trim();
				profiles = generateRandomProfilesWithPattern(
					count,
					(index, seed) => {
						return pattern
							.replace(/{index}/g, String(index))
							.replace(/{index0}/g, String(index))
							.replace(/{index1}/g, String(index + 1))
							.replace(/{seed}/g, seed.toString(16))
							.replace(/{seedDec}/g, String(seed));
					},
					{
						proxyIds: selectedProxies.length > 0 ? selectedProxies : undefined,
						seed: useSeed ? parseInt(seedValue || "0", 10) : undefined,
					}
				);
			} else {
				// Use standard generation with progress
				const options: RandomProfileGeneratorOptions = {
					count,
					proxyIds: selectedProxies.length > 0 ? selectedProxies : undefined,
					seed: useSeed ? parseInt(seedValue || "0", 10) : undefined,
					useAutoNames,
				};

				profiles = await generateRandomProfilesAsync(
					options,
					(current, total) => {
						generationProgress = (current / total) * 100;
					}
				);
			}

			generatedProfiles = profiles;
			successMsg = `Generated ${profiles.length} profiles successfully`;
			showResults = true;
		} catch (e) {
			errorMsg = `Generation failed: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			isGenerating = false;
		}
	}

	// Save generated profiles
	async function handleSaveProfiles() {
		errorMsg = "";
		successMsg = "";

		try {
			isSaving = true;

			for (let i = 0; i < generatedProfiles.length; i++) {
				const profile = generatedProfiles[i];
				await profileStore.createProfile(
					{
						name: profile.name,
						seed: profile.seed,
						proxy_id: profile.proxy_id,
						behavior_profile: profile.behavior_profile,
					},
					profile.target
				);
			}

			successMsg = `Saved ${generatedProfiles.length} profiles to database`;
			onProfilesGenerated?.(generatedProfiles);
		} catch (e) {
			errorMsg = `Failed to save profiles: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			isSaving = false;
		}
	}

	// Export as JSON
	function handleExport() {
		const json = exportProfilesToJson(generatedProfiles);
		const blob = new Blob([json], { type: "application/json" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `profiles-${Date.now()}.json`;
		a.click();
		URL.revokeObjectURL(url);
	}

	// Reset form
	function handleReset() {
		count = 10;
		useAutoNames = true;
		useCustomPattern = false;
		selectedProxies = [];
		useSeed = false;
		seedValue = "";
		generatedProfiles = [];
		showResults = false;
		errorMsg = "";
		successMsg = "";
		generationProgress = 0;
	}

	// Initialize
	import { onMount } from "svelte";
	onMount(async () => {
		await loadProxies();
	});
</script>

<div class="modal" role="dialog" aria-modal="true" aria-label="Batch Profile Generator">
	<header class="modal-header">
		<div class="header-meta">
			<h2 class="modal-title">Batch Profile Generator</h2>
			<p class="modal-subtitle">Generate (x) amount of random profiles for automation</p>
		</div>
		<button class="btn-close" onclick={onClose} aria-label="Close">
			<span>✕</span>
		</button>
	</header>

	<div class="modal-body">
		{#if !showResults}
			<!-- Generation Form -->
			<div class="form-section">
				<div class="field-group">
					<label class="field-label" for="profile-count">Profile Count</label>
					<input
						id="profile-count"
						type="number"
						min="1"
						max="10000"
						bind:value={count}
						disabled={isGenerating}
						placeholder="10"
					/>
					<span class="hint">Generate 1 to 10,000 profiles</span>
				</div>

				<!-- Naming Strategy -->
				<div class="field-group">
					<span class="field-label">Profile Names</span>
					<div class="toggle-group">
						<label class="toggle-label">
							<input
								type="radio"
								name="naming"
								value="auto"
								checked={!useCustomPattern}
								onchange={() => {
									useCustomPattern = false;
									useAutoNames = true;
								}}
								disabled={isGenerating}
							/>
							<span class="toggle-text">
								{#if useAutoNames}
									Auto names (e.g., swift-falcon-AB12)
								{:else}
									Seed-based (e.g., Profile-12345678)
								{/if}
							</span>
						</label>
						<label class="toggle-label">
							<input
								type="radio"
								name="naming"
								value="custom"
								checked={useCustomPattern}
								onchange={() => {
									useCustomPattern = true;
								}}
								disabled={isGenerating}
							/>
							<span class="toggle-text">Custom pattern</span>
						</label>
					</div>
				</div>

				{#if useCustomPattern}
					<div class="field-group">
						<label class="field-label" for="pattern">Pattern</label>
						<input
							id="pattern"
							type="text"
							bind:value={customPattern}
							disabled={isGenerating}
							placeholder="profile-{index1}"
						/>
						<span class="hint">
							Available: {"{index}"}, {"{index0}"}, {"{index1}"}, {"{seed}"}, {"{seedDec}"}
						</span>
					</div>
				{/if}

				<!-- Proxy Selection -->
				<div class="field-group">
					<label class="field-label">Proxies (Optional)</label>
					{#if proxyList.length > 0}
						<div class="proxy-header">
							<button
								class="toggle-all-btn"
								onclick={toggleAllProxies}
								disabled={isGenerating}
							>
								{selectedProxies.length === proxyList.length ? "Deselect All" : "Select All"}
							</button>
							<span class="proxy-count">
								{selectedProxies.length} / {proxyList.length}
							</span>
						</div>
						<div class="proxy-list">
							{#each proxyList as proxy}
								<label class="checkbox-label">
									<input
										type="checkbox"
										checked={selectedProxies.includes(proxy.id)}
										onchange={() => toggleProxy(proxy.id)}
										disabled={isGenerating}
									/>
									<span>{proxy.name}</span>
								</label>
							{/each}
						</div>
					{:else}
						<span class="hint">No proxies configured</span>
					{/if}
				</div>

				<!-- Seed -->
				<div class="field-group">
					<label class="checkbox-label">
						<input
							type="checkbox"
							bind:checked={useSeed}
							disabled={isGenerating}
						/>
						<span>Use deterministic seed</span>
					</label>
					{#if useSeed}
						<input
							type="text"
							bind:value={seedValue}
							disabled={isGenerating}
							placeholder="12345"
						/>
						<span class="hint">Same seed will always generate the same profiles</span>
					{/if}
				</div>

				<!-- Messages -->
				{#if errorMsg}
					<div class="message error">{errorMsg}</div>
				{/if}
				{#if successMsg}
					<div class="message success">{successMsg}</div>
				{/if}

				<!-- Progress -->
				{#if isGenerating && generationProgress > 0 && generationProgress < 100}
					<div class="progress-container">
						<div class="progress-bar">
							<div
								class="progress-fill"
								style="width: {generationProgress}%"
							></div>
						</div>
						<span class="progress-text">{Math.round(generationProgress)}%</span>
					</div>
				{/if}
			</div>
		{:else}
			<!-- Results Display -->
			<div class="results-section">
				<div class="results-header">
					<h3>Generated {generatedProfiles.length} Profiles</h3>
					<span class="results-count">{generatedProfiles.length} profiles ready</span>
				</div>

				<div class="profiles-preview">
					{#each generatedProfiles.slice(0, 5) as profile, i}
						<div class="profile-item">
							<div class="profile-name">{profile.name}</div>
							<div class="profile-meta">
								<span class="badge behavior">{profile.behavior_profile}</span>
								{#if profile.proxy_id}
									<span class="badge proxy">Has proxy</span>
								{/if}
								<span class="seed">
									Seed: {(profile.seed >>> 0).toString(16).toUpperCase()}
								</span>
							</div>
						</div>
					{/each}
				</div>

				{#if generatedProfiles.length > 5}
					<div class="more-indicator">
						+{generatedProfiles.length - 5} more profiles
					</div>
				{/if}

				{#if errorMsg}
					<div class="message error">{errorMsg}</div>
				{/if}
				{#if successMsg}
					<div class="message success">{successMsg}</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Footer -->
	<footer class="modal-footer">
		<div class="footer-actions">
			{#if !showResults}
				<button class="btn btn-secondary" onclick={onClose} disabled={isGenerating}>
					Cancel
				</button>
				<button
					class="btn btn-primary"
					onclick={handleGenerate}
					disabled={isGenerating}
				>
					{#if isGenerating}
						Generating...
					{:else}
						Generate {count} Profiles
					{/if}
				</button>
			{:else}
				<button class="btn btn-secondary" onclick={handleReset} disabled={isSaving}>
					Back
				</button>
				<div class="button-group">
					<button
						class="btn btn-secondary"
						onclick={handleExport}
						disabled={isSaving}
					>
						Export JSON
					</button>
					<button
						class="btn btn-primary"
						onclick={handleSaveProfiles}
						disabled={isSaving}
					>
						{#if isSaving}
							Saving...
						{:else}
							Save All Profiles
						{/if}
					</button>
				</div>
			{/if}
		</div>
	</footer>
</div>

<style>
	.modal {
		position: fixed;
		inset: 0;
		display: flex;
		flex-direction: column;
		background: var(--bg-0, #ffffff);
		border-radius: 8px;
		box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
		max-width: 600px;
		width: 90%;
		max-height: 80vh;
		margin: auto;
		z-index: 1000;
	}

	.modal-header {
		padding: 24px;
		border-bottom: 1px solid var(--border-color, #e5e7eb);
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
	}

	.header-meta {
		flex: 1;
	}

	.modal-title {
		margin: 0;
		font-size: 20px;
		font-weight: 600;
		color: var(--text-0, #1f2937);
	}

	.modal-subtitle {
		margin: 4px 0 0 0;
		font-size: 13px;
		color: var(--text-2, #6b7280);
	}

	.btn-close {
		background: none;
		border: none;
		font-size: 24px;
		cursor: pointer;
		color: var(--text-2, #6b7280);
		padding: 0;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		transition: all 0.2s;
	}

	.btn-close:hover {
		background: var(--bg-2, #f3f4f6);
		color: var(--text-0, #1f2937);
	}

	.modal-body {
		flex: 1;
		overflow-y: auto;
		padding: 24px;
	}

	.form-section,
	.results-section {
		display: flex;
		flex-direction: column;
		gap: 16px;
	}

	.field-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.field-label {
		font-size: 13px;
		font-weight: 500;
		color: var(--text-1, #374151);
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	input[type="text"],
	input[type="number"],
	input[type="password"] {
		padding: 8px 12px;
		border: 1px solid var(--border-color, #e5e7eb);
		border-radius: 4px;
		background: var(--bg-1, #f9fafb);
		color: var(--text-0, #1f2937);
		font-size: 14px;
		transition: all 0.2s;
	}

	input[type="text"]:focus,
	input[type="number"]:focus,
	input[type="password"]:focus {
		outline: none;
		border-color: #3b82f6;
		background: var(--bg-0, #ffffff);
		box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
	}

	input:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.hint {
		font-size: 12px;
		color: var(--text-2, #6b7280);
	}

	.toggle-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.toggle-label {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		font-size: 14px;
		color: var(--text-1, #374151);
	}

	.toggle-label input {
		cursor: pointer;
	}

	.toggle-text {
		flex: 1;
	}

	.checkbox-label {
		display: flex;
		align-items: center;
		gap: 8px;
		cursor: pointer;
		font-size: 14px;
		color: var(--text-1, #374151);
		padding: 8px 0;
	}

	.checkbox-label input {
		cursor: pointer;
	}

	.proxy-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px;
		margin-bottom: 8px;
	}

	.toggle-all-btn {
		background: none;
		border: none;
		color: #3b82f6;
		font-weight: 500;
		cursor: pointer;
		font-size: 13px;
		padding: 4px 8px;
		border-radius: 3px;
		transition: all 0.2s;
	}

	.toggle-all-btn:hover:not(:disabled) {
		background: rgba(59, 130, 246, 0.1);
	}

	.toggle-all-btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.proxy-count {
		font-size: 12px;
		color: var(--text-2, #6b7280);
	}

	.proxy-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px;
		background: var(--bg-1, #f9fafb);
		border-radius: 4px;
		border: 1px solid var(--border-color, #e5e7eb);
		max-height: 200px;
		overflow-y: auto;
	}

	.progress-container {
		display: flex;
		align-items: center;
		gap: 12px;
	}

	.progress-bar {
		flex: 1;
		height: 6px;
		background: var(--bg-2, #f3f4f6);
		border-radius: 3px;
		overflow: hidden;
	}

	.progress-fill {
		height: 100%;
		background: #3b82f6;
		transition: width 0.3s ease;
	}

	.progress-text {
		font-size: 12px;
		color: var(--text-2, #6b7280);
		min-width: 35px;
	}

	.message {
		padding: 12px;
		border-radius: 4px;
		font-size: 13px;
		line-height: 1.4;
	}

	.message.error {
		background: rgba(239, 68, 68, 0.1);
		color: #ef4444;
		border: 1px solid rgba(239, 68, 68, 0.2);
	}

	.message.success {
		background: rgba(34, 197, 94, 0.1);
		color: #22c55e;
		border: 1px solid rgba(34, 197, 94, 0.2);
	}

	.results-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 16px;
	}

	.results-header h3 {
		margin: 0;
		font-size: 16px;
		font-weight: 600;
	}

	.results-count {
		font-size: 12px;
		color: var(--text-2, #6b7280);
		background: var(--bg-1, #f9fafb);
		padding: 4px 8px;
		border-radius: 3px;
	}

	.profiles-preview {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.profile-item {
		padding: 12px;
		background: var(--bg-1, #f9fafb);
		border: 1px solid var(--border-color, #e5e7eb);
		border-radius: 4px;
	}

	.profile-name {
		font-weight: 500;
		color: var(--text-0, #1f2937);
		margin-bottom: 8px;
	}

	.profile-meta {
		display: flex;
		align-items: center;
		gap: 8px;
		flex-wrap: wrap;
		font-size: 12px;
	}

	.badge {
		display: inline-block;
		padding: 2px 6px;
		border-radius: 3px;
		font-size: 11px;
		font-weight: 500;
	}

	.badge.behavior {
		background: rgba(59, 130, 246, 0.15);
		color: #3b82f6;
	}

	.badge.proxy {
		background: rgba(168, 85, 247, 0.15);
		color: #a855f7;
	}

	.seed {
		font-family: monospace;
		color: var(--text-2, #6b7280);
	}

	.more-indicator {
		padding: 8px 12px;
		text-align: center;
		font-size: 12px;
		color: var(--text-2, #6b7280);
		background: var(--bg-1, #f9fafb);
		border-radius: 4px;
	}

	.modal-footer {
		padding: 16px 24px;
		border-top: 1px solid var(--border-color, #e5e7eb);
		background: var(--bg-1, #f9fafb);
	}

	.footer-actions {
		display: flex;
		justify-content: flex-end;
		gap: 12px;
		align-items: center;
	}

	.button-group {
		display: flex;
		gap: 12px;
	}

	.btn {
		padding: 8px 16px;
		border: none;
		border-radius: 4px;
		font-size: 13px;
		font-weight: 500;
		cursor: pointer;
		transition: all 0.2s;
		text-transform: uppercase;
		letter-spacing: 0.5px;
	}

	.btn-primary {
		background: #3b82f6;
		color: white;
	}

	.btn-primary:hover:not(:disabled) {
		opacity: 0.9;
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
	}

	.btn-secondary {
		background: var(--bg-2, #f3f4f6);
		color: var(--text-0, #1f2937);
	}

	.btn-secondary:hover:not(:disabled) {
		background: var(--bg-3, #e5e7eb);
	}

	.btn:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
