<script>
	import { getContext } from 'svelte';

	function addSelectedTokensAsTargets() {
		messageDocument.addSelectedTokensAsTargets();
	}

	function addTargetedTokensAsTargets() {
		messageDocument.addTargetedTokensAsTargets();
	}

	function hasDamageEffects(effects) {
		if (!Array.isArray(effects)) return false;
		return effects.some((node) => node?.type === 'damage');
	}

	function getArmorIcon(token) {
		const armor = token.actor?.system?.attributes.armor;
		const armorIcon = npcArmorIcons[armor];

		if (armor !== 'heavy' && armor !== 'medium') return null;

		return `
		<i
            class="nimble-armor-icon ${armorIcon}"
            data-tooltip="${getArmorTooltip(armor)}"
            data-tooltip-class='nimble-tooltip nimble-tooltip--rules';
        >
		</i>
	`;
	}

	function getArmorTooltip(armor) {
		const armorEffect = npcArmorEffects[armor];
		const armorIcon = npcArmorIcons[armor];
		const armorLabel = npcArmorTypes[armor];

		return `
        <header class='nimble-tooltip__enricher-header'>
            <h3 class='nimble-tooltip__enricher-heading'>
                <i class='${armorIcon}'></i>
                ${armorLabel}
            </h3>
        </header>

        ${armorEffect}
    `;
	}

	async function handleTokenHighlight(event, tokenDocument, mode) {
		event.preventDefault();

		const token = tokenDocument.object;

		if (!token || !token.isVisible || token.controlled) return;

		if (mode === 'enter') {
			token._onHoverIn(event, { hoverOutOthers: true });
		} else {
			token._onHoverOut(event);
		}
	}

	async function prepareTargets(targetIDs) {
		const tokenDocuments = await Promise.all(targetIDs.map((id) => fromUuid(id)));
		return tokenDocuments.filter(Boolean);
	}

	function removeTarget(targetId) {
		messageDocument.removeTarget(targetId);
	}

	function canShowDefendControls(tokenDocument) {
		return hasDamageEffect && messageDocument.canTargetDefend(tokenDocument.uuid);
	}

	function canSetDefendChoice(targetId) {
		return messageDocument.canUserSetDefendChoice(targetId);
	}

	function hasDefendChoice(targetId, choice) {
		const selected = foundry.utils.getProperty(defendChoices, targetId);
		return selected === choice;
	}

	async function setDefendChoice(targetId, choice) {
		try {
			await messageDocument.setDefendChoice(targetId, choice);
		} catch (_error) {
			ui.notifications?.warn('Could not update Defend choice.');
		}
	}

	const { npcArmorEffects, npcArmorIcons, npcArmorTypes } = CONFIG.NIMBLE;

	let messageDocument = getContext('messageDocument');
	let targets = $derived(messageDocument.reactive.system.targets ?? []);
	let defendChoices = $derived(messageDocument.reactive.system.defendChoices ?? {});
	let hasDamageEffect = $derived(
		hasDamageEffects(messageDocument.reactive.system.activation?.effects),
	);
</script>

<section class="nimble-card-section nimble-card-section--targets">
	<header class="nimble-section-header">
		<h3 class="nimble-heading" data-heading-variant="section">Targets</h3>

		<button
			class="nimble-button"
			data-button-variant="icon"
			aria-label="Add Selected Tokens as Targets"
			data-tooltip="Add Selected Tokens as Targets"
			type="button"
			onclick={addSelectedTokensAsTargets}
		>
			<i class="nimble-button__icon fa-solid fa-plus"></i>
		</button>

		<button
			class="nimble-button"
			data-button-variant="icon"
			aria-label="Add Targeted Tokens as Targets"
			data-tooltip="Add Targeted Tokens as Targets"
			type="button"
			onclick={addTargetedTokensAsTargets}
		>
			<i class="nimble-button__icon fa-solid fa-crosshairs"></i>
		</button>
	</header>

	<ul class="nimble-target-list">
		{#await prepareTargets(targets) then tokens}
			{#each tokens as token}
				<li
					class="nimble-card"
					onmouseenter={(event) => handleTokenHighlight(event, token, 'enter')}
					onmouseleave={(event) => handleTokenHighlight(event, token, 'leave')}
				>
					<img
						class="nimble-card__img"
						src={token.texture.src || 'icons/svg/mystery-man.svg'}
						alt={token?.actor?.name || token.name}
					/>

					<span class="nimble-card__title">
						{token?.actor?.name || token.name}
					</span>

					{#if token?.actor?.type !== 'character'}
						<span class="nimble-target-list__meta">
							{@html getArmorIcon(token)}
						</span>
					{/if}

					{#if canShowDefendControls(token)}
						<div class="nimble-target-list__defend-controls">
							<button
								class="nimble-button nimble-defend-button"
								class:nimble-defend-button--yes-active={hasDefendChoice(token.uuid, 'yes')}
								type="button"
								data-tooltip="Use Defend"
								disabled={!canSetDefendChoice(token.uuid)}
								onclick={() => setDefendChoice(token.uuid, 'yes')}
							>
								<span>Yes</span>
							</button>

							<button
								class="nimble-button nimble-defend-button"
								class:nimble-defend-button--no-active={hasDefendChoice(token.uuid, 'no')}
								type="button"
								data-tooltip="Do Not Defend"
								disabled={!canSetDefendChoice(token.uuid)}
								onclick={() => setDefendChoice(token.uuid, 'no')}
							>
								<span>No</span>
							</button>
						</div>
					{/if}

					<button
						class="nimble-button nimble-target-list__remove-button"
						aria-label="Remove Target"
						data-button-variant="icon"
						data-tooltip="Remove Target"
						type="button"
						onclick={() => removeTarget(token.uuid)}
					>
						<i class="fa-solid fa-trash"></i>
					</button>
				</li>
			{:else}
				<li style="color: var(--nimble-medium-text-color);">No targets selected</li>
			{/each}
		{/await}
	</ul>
</section>

<style lang="scss">
	.nimble-button {
		&__icon {
			line-height: 0;
		}
	}

	.nimble-card-section {
		padding: var(--nimble-card-section-padding, 0);

		&--targets {
			--nimble-card-section-padding: 0.5rem;
		}

		&:not(:last-of-type) {
			border-bottom: 1px solid var(--nimble-card-border-color);
		}
	}

	.nimble-target-list {
		--nimble-button-padding: 0;

		--nimble-card-content-grid: 'img title meta defend button';
		--nimble-card-column-dimensions: 1.75rem 1fr 1rem max-content 1.35rem;
		--nimble-card-row-dimensions: 1.75rem;

		--nimble-card-title-alignment: center;
		--nimble-card-title-justification: start;

		--nimble-card-image-height: 1.75rem;
		--nimble-card-image-width: 1.75rem;

		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		list-style: none;
		padding: 0;
		margin: 0;
	}

	.nimble-target-list__meta {
		grid-area: meta;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}

	.nimble-target-list__defend-controls {
		grid-area: defend;
		display: inline-flex;
		align-items: center;
		gap: 0.18rem;
	}

	.nimble-target-list__remove-button {
		grid-area: button;
		align-self: center;
		justify-self: center;
		pointer-events: all;
	}

	.nimble-defend-button {
		--nimble-shield-shape: polygon(50% 0%, 92% 15%, 84% 67%, 50% 100%, 16% 67%, 8% 15%);
		--nimble-shield-border-color: var(--nimble-card-border-color);
		--nimble-shield-fill-color: rgba(0, 0, 0, 0.22);
		--nimble-shield-text-color: var(--nimble-medium-text-color);

		position: relative;
		width: 1.8rem;
		height: 1.9rem;
		padding: 0;
		border: 0;
		background: transparent;
		color: var(--nimble-shield-text-color);
		font-size: 0.72rem;
		font-weight: 700;
		line-height: 1;
		text-transform: uppercase;
		letter-spacing: 0.01em;
		pointer-events: all;
		opacity: 0.9;

		&::before {
			content: '';
			position: absolute;
			inset: 0;
			background: var(--nimble-shield-border-color);
			clip-path: var(--nimble-shield-shape);
		}

		&::after {
			content: '';
			position: absolute;
			inset: 1.5px;
			background: var(--nimble-shield-fill-color);
			clip-path: var(--nimble-shield-shape);
		}

		span {
			position: relative;
			z-index: 1;
			translate: 0 2px;
		}

		&:hover {
			opacity: 1;
			filter: brightness(1.08);
		}

		&--yes-active {
			--nimble-shield-border-color: hsl(140, 55%, 35%);
			--nimble-shield-fill-color: hsl(140, 55%, 28%);
			--nimble-shield-text-color: hsl(140, 70%, 90%);
		}

		&--no-active {
			--nimble-shield-border-color: hsl(0, 65%, 40%);
			--nimble-shield-fill-color: hsl(0, 65%, 30%);
			--nimble-shield-text-color: hsl(0, 75%, 91%);
		}

		&:disabled {
			opacity: 0.45;
			cursor: not-allowed;
			filter: none;
		}
	}
</style>
