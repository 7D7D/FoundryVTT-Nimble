import { COMBATANT_FLAG_KEYS, HERO_REACTION_IDS, MODULE_ID, SETTINGS } from './constants.js';
import { getSetting } from './settings.js';

function toNumber(value, fallback = 0) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function normalizeCost(cost) {
	return Math.max(0, Math.floor(toNumber(cost, 0)));
}

function warn(message, quiet = false) {
	if (!quiet) {
		ui.notifications?.warn(message);
	}
}

function getSceneScopedCombatant(combat, actorId) {
	if (!combat || !actorId) return null;

	const sceneId = canvas?.scene?.id ?? null;
	const sceneMatch =
		combat.combatants?.find(
			(combatant) => combatant.actor?.id === actorId && (!sceneId || combatant.sceneId === sceneId),
		) ?? null;

	if (sceneMatch) return sceneMatch;
	return combat.combatants?.find((combatant) => combatant.actor?.id === actorId) ?? null;
}

function getHeroicAvailability(combatant, reactionId) {
	if (reactionId === HERO_REACTION_IDS.DEFEND) {
		return foundry.utils.getProperty(combatant, 'system.actions.heroic.defendAvailable') !== false;
	}
	if (reactionId === HERO_REACTION_IDS.INTERPOSE) {
		return (
			foundry.utils.getProperty(combatant, 'system.actions.heroic.interposeAvailable') !== false
		);
	}
	return true;
}

function getCombatRound(combatant) {
	return Math.max(0, Math.floor(toNumber(combatant?.parent?.round, 0)));
}

function getReactionRoundFlagKey(reactionId) {
	return COMBATANT_FLAG_KEYS.REACTION_ROUND[reactionId] ?? null;
}

function hasUsedRoundLimitedReaction(combatant, reactionId) {
	const flagKey = getReactionRoundFlagKey(reactionId);
	if (!flagKey) return false;

	const currentRound = getCombatRound(combatant);
	const usedRound = toNumber(combatant.getFlag(MODULE_ID, flagKey), -1);
	return usedRound === currentRound;
}

export function getCombatantForActor(actor) {
	if (!actor) return null;

	const argonCombatant = ui?.ARGON?._token?.combatant ?? null;
	if (argonCombatant?.actor?.id === actor.id) return argonCombatant;

	const activeCombatant = getSceneScopedCombatant(game.combat, actor.id);
	if (activeCombatant) return activeCombatant;

	if (actor.combatant) return actor.combatant;

	for (const combat of game.combats?.contents ?? []) {
		const combatant = getSceneScopedCombatant(combat, actor.id);
		if (combatant) return combatant;
	}

	return null;
}

export function getActionsData(combatant) {
	return {
		current: normalizeCost(foundry.utils.getProperty(combatant, 'system.actions.base.current')),
		max: normalizeCost(foundry.utils.getProperty(combatant, 'system.actions.base.max')),
	};
}

export function isActorTurn(actor) {
	const combat = game.combat;
	const activeCombatant = combat?.combatant ?? null;
	if (!actor || !combat?.started || !activeCombatant) return false;
	return activeCombatant.actor?.id === actor.id;
}

export function canSpendTurnActions(actor, cost = 1, { quiet = false } = {}) {
	if (!getSetting(SETTINGS.ENFORCE_ACTION_ECONOMY)) return true;

	const actionCost = normalizeCost(cost);
	if (actionCost <= 0) return true;

	const combatant = getCombatantForActor(actor);
	const combat = combatant?.parent ?? null;
	if (!combat?.started) return true;

	const { current } = getActionsData(combatant);
	if (current < actionCost) {
		warn(`${actor.name} does not have enough actions (${current}/${actionCost} required).`, quiet);
		return false;
	}

	return true;
}

export async function spendTurnActions(actor, cost = 1, { quiet = false } = {}) {
	if (!getSetting(SETTINGS.ENFORCE_ACTION_ECONOMY)) return true;

	const actionCost = normalizeCost(cost);
	if (actionCost <= 0) return true;
	if (!canSpendTurnActions(actor, actionCost, { quiet })) return false;

	const combatant = getCombatantForActor(actor);
	const combat = combatant?.parent ?? null;
	if (!combat?.started) return true;

	const { current } = getActionsData(combatant);
	const nextValue = Math.max(0, current - actionCost);

	try {
		await combatant.update({ 'system.actions.base.current': nextValue });
		return true;
	} catch (error) {
		console.error('Nimble Argon | Failed to spend actions.', error);
		warn(`Could not update actions for ${actor.name}.`, quiet);
		return false;
	}
}

export function canUseHeroicReaction(actor, reactionId, { quiet = false } = {}) {
	if (!getSetting(SETTINGS.ENFORCE_ACTION_ECONOMY)) return true;

	const combatant = getCombatantForActor(actor);
	const combat = combatant?.parent ?? null;
	if (!combat?.started) return true;

	if (isActorTurn(actor)) {
		warn('Heroic reactions can only be used when it is not your turn.', quiet);
		return false;
	}

	if (!canSpendTurnActions(actor, 1, { quiet })) {
		return false;
	}

	if (!getHeroicAvailability(combatant, reactionId)) {
		warn(`${reactionId} is already used this round.`, quiet);
		return false;
	}

	if (hasUsedRoundLimitedReaction(combatant, reactionId)) {
		warn(`${reactionId} is already used this round.`, quiet);
		return false;
	}

	return true;
}

export async function spendHeroicReaction(actor, reactionId, { quiet = false } = {}) {
	if (!canUseHeroicReaction(actor, reactionId, { quiet })) return false;
	if (!(await spendTurnActions(actor, 1, { quiet: true }))) return false;

	const combatant = getCombatantForActor(actor);
	const combat = combatant?.parent ?? null;
	if (!combat?.started) return true;

	const updates = {};
	if (reactionId === HERO_REACTION_IDS.DEFEND) {
		updates['system.actions.heroic.defendAvailable'] = false;
	}
	if (reactionId === HERO_REACTION_IDS.INTERPOSE) {
		updates['system.actions.heroic.interposeAvailable'] = false;
	}

	try {
		if (Object.keys(updates).length > 0) {
			await combatant.update(updates);
		}

		const flagKey = getReactionRoundFlagKey(reactionId);
		if (flagKey) {
			await combatant.setFlag(MODULE_ID, flagKey, getCombatRound(combatant));
		}

		return true;
	} catch (error) {
		console.error('Nimble Argon | Failed to register heroic reaction use.', error);
		warn(`Could not register ${reactionId} for ${actor.name}.`, quiet);
		return false;
	}
}

export function getItemActivationCost(item) {
	const costData = item?.system?.activation?.cost ?? {};
	const type = String(costData.type ?? 'none');
	const isReaction = Boolean(costData.isReaction);

	let quantity = normalizeCost(costData.quantity);
	if (type === 'action' && quantity === 0) {
		quantity = 1;
	}

	return { type, quantity, isReaction };
}

export function canPayItemActivationCost(actor, item, { quiet = false } = {}) {
	if (!getSetting(SETTINGS.ENFORCE_ACTION_ECONOMY)) return true;

	const { type, quantity, isReaction } = getItemActivationCost(item);
	if (type !== 'action' || quantity <= 0) return true;

	const combatant = getCombatantForActor(actor);
	const combat = combatant?.parent ?? null;
	if (isReaction && combat?.started && isActorTurn(actor)) {
		warn('Reaction-cost items can only be used when it is not your turn.', quiet);
		return false;
	}

	return canSpendTurnActions(actor, quantity, { quiet });
}

export async function payItemActivationCost(actor, item, { quiet = false } = {}) {
	if (!getSetting(SETTINGS.ENFORCE_ACTION_ECONOMY)) return true;

	const { type, quantity, isReaction } = getItemActivationCost(item);
	if (type !== 'action' || quantity <= 0) return true;

	const combatant = getCombatantForActor(actor);
	const combat = combatant?.parent ?? null;
	if (isReaction && combat?.started && isActorTurn(actor)) {
		warn('Reaction-cost items can only be used when it is not your turn.', quiet);
		return false;
	}

	return spendTurnActions(actor, quantity, { quiet });
}

export async function postPlaceholderToChat({ actor, title, description, isReaction = false }) {
	if (!actor) return null;

	const note = isReaction ? 'Heroic Reaction Placeholder' : 'Heroic Action Placeholder';
	const content = `
		<div class="nimble-argon-chat-card">
			<header>${title}</header>
			<p>${description}</p>
			<footer>${note}</footer>
		</div>
	`;

	return ChatMessage.create({
		author: game.user?.id,
		speaker: ChatMessage.getSpeaker({ actor }),
		flavor: `${actor.name}: ${title}`,
		content,
		style: CONST.CHAT_MESSAGE_STYLES.OTHER,
	});
}

export async function resetHeroicReactionAvailabilityForNewRound(combat, changes) {
	if (!game.user?.isGM || !combat?.started) return;
	if (!Object.hasOwn(changes ?? {}, 'round')) return;

	const updates = [];
	for (const combatant of combat.combatants ?? []) {
		if (combatant.type !== 'character' || !combatant.id) continue;

		const defendAvailable = getHeroicAvailability(combatant, HERO_REACTION_IDS.DEFEND);
		const interposeAvailable = getHeroicAvailability(combatant, HERO_REACTION_IDS.INTERPOSE);
		if (defendAvailable && interposeAvailable) continue;

		updates.push({
			_id: combatant.id,
			'system.actions.heroic.defendAvailable': true,
			'system.actions.heroic.interposeAvailable': true,
		});
	}

	if (updates.length > 0) {
		await combat.updateEmbeddedDocuments('Combatant', updates);
	}
}
