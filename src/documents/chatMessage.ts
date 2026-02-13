export type SystemChatMessageTypes = Exclude<foundry.documents.BaseChatMessage.SubType, 'base'>;

import { createSubscriber } from 'svelte/reactivity';
import type { EffectNode } from '#types/effectTree.js';
import { getRelevantNodes } from '#view/dataPreparationHelpers/effectTree/getRelevantNodes.ts';

/** Types for activation cards that have targets and effects */
type ActivationCardTypes = 'feature' | 'object' | 'spell';
type DefendChoice = 'yes' | 'no';

interface DamageApplicationOptions {
	ignoreArmor: boolean;
	outcome?: string;
}

/** System data for activation cards */
interface ActivationCardSystemData {
	targets: string[];
	defendChoices?: Record<string, unknown>;
	isCritical: boolean;
	isMiss: boolean;
	activation: {
		effects: unknown[];
		[key: string]: unknown;
	};
	[key: string]: unknown;
}

class NimbleChatMessage extends ChatMessage {
	declare type: SystemChatMessageTypes;

	#subscribe: ReturnType<typeof createSubscriber>;

	constructor(data: ChatMessage.CreateData, context?: ChatMessage.ConstructionContext) {
		super(data, context);

		this.#subscribe = createSubscriber((update) => {
			const updateActorHook = Hooks.on('updateActor', (triggeringDocument, _change, options) => {
				if ((options as { diff?: boolean }).diff === false) return;

				let requiresUpdate = false;

				if (this.isActivationCard()) {
					const actorWithTokens = triggeringDocument as {
						getDependentTokens?(): { uuid: string }[];
					};
					const dependentTokens = actorWithTokens.getDependentTokens?.() ?? [];
					const systemData = this.system as ActivationCardSystemData;

					for (const token of dependentTokens) {
						if (systemData.targets?.includes(token.uuid)) requiresUpdate = true;
					}
				}

				if (requiresUpdate) update();
			});

			const updateChatMessageHook = Hooks.on(
				'updateChatMessage',
				(triggeringDocument, _change, options) => {
					if ((options as { diff?: boolean }).diff === false) return;
					if (triggeringDocument._id === this.id) update();
				},
			);

			const updateCombatantHook = Hooks.on(
				'updateCombatant',
				(triggeringCombatant, _change, options) => {
					if ((options as { diff?: boolean }).diff === false) return;
					if (!this.isActivationCard()) return;

					const targetUuid = this.#getCombatantTokenUuid(triggeringCombatant);
					const systemData = this.system as ActivationCardSystemData;
					if (targetUuid && systemData.targets?.includes(targetUuid)) update();
				},
			);

			const updateUserHook = Hooks.on('updateUser', (triggeringDocument, _change, options) => {
				if ((options as { diff?: boolean }).diff === false) return;
				if (triggeringDocument._id === this.author?.id) update();
			});

			return () => {
				Hooks.off('updateActor', updateActorHook);
				Hooks.off('updateChatMessage', updateChatMessageHook);
				Hooks.off('updateCombatant', updateCombatantHook);
				Hooks.off('updateUser', updateUserHook);
			};
		});
	}

	/** ------------------------------------------------------ */
	/**                    Type Helpers                        */
	/** ------------------------------------------------------ */
	isType<TypeName extends SystemChatMessageTypes>(type: TypeName): boolean {
		return type === this.type;
	}

	/** Check if this chat message is an activation card type (feature, object, or spell) */
	isActivationCard(): this is NimbleChatMessage & { system: ActivationCardSystemData } {
		return (this.activationCardTypes as string[]).includes(this.type);
	}

	/** ------------------------------------------------------ */
	/**                       Getters                          */
	/** ------------------------------------------------------ */
	get activationCardTypes(): ActivationCardTypes[] {
		return ['feature', 'object', 'spell'];
	}

	get reactive() {
		this.#subscribe();

		return this;
	}

	get effectNodes(): EffectNode[][] {
		if (!this.isActivationCard()) return [];

		const contexts: string[] = [];
		const systemData = this.system as ActivationCardSystemData;

		if (systemData.isCritical) contexts.push('criticalHit', 'hit');
		else if (systemData.isMiss) contexts.push('miss');
		else contexts.push('hit');

		const effects = (systemData.activation.effects || []) as EffectNode[];
		const nodes = getRelevantNodes(effects, contexts, {
			includeBaseDamageNodes: systemData.isMiss,
		});

		// Add a "MISS" text hint at the start if the attack missed and there isn't one already
		if (systemData.isMiss) {
			const hasMissHint = nodes.some((group) =>
				group.some(
					(node) =>
						node.type === 'note' && (node as { text?: string }).text?.toUpperCase() === 'MISS',
				),
			);

			if (!hasMissHint) {
				const missHintNode: EffectNode = {
					id: 'miss-hint',
					type: 'note',
					noteType: 'warning',
					text: 'MISS',
					parentContext: 'miss',
					parentNode: null,
				};
				// Insert as the first group
				nodes.unshift([missHintNode]);
			}
		}

		return nodes;
	}

	/** ------------------------------------------------------ */
	/**                     Data Prep                          */
	/** ------------------------------------------------------ */
	override prepareDerivedData() {
		super.prepareDerivedData();
	}

	async addSelectedTokensAsTargets(): Promise<ChatMessage | undefined> {
		if (!this.isActivationCard()) {
			ui.notifications?.warn('Cannot open a target management window for this message type.');
			return;
		}

		const selectedTokens = canvas.tokens?.controlled ?? [];

		if (!selectedTokens.length) {
			ui.notifications?.error('No tokens selected');
			return;
		}

		return this.#addTargets(selectedTokens);
	}

	async addTargetedTokensAsTargets(): Promise<ChatMessage | undefined> {
		if (!this.isActivationCard()) {
			ui.notifications?.warn('Cannot open a target management window for this message type.');
			return;
		}

		const targetedTokens = Array.from(game.user?.targets ?? []);

		if (!targetedTokens.length) {
			ui.notifications?.error('No tokens targeted');
			return;
		}

		return this.#addTargets(targetedTokens);
	}

	async #addTargets(newTargets: Token[]): Promise<ChatMessage | undefined> {
		if (!this.isActivationCard()) return;

		const systemData = this.system as ActivationCardSystemData;
		const existingTargets = systemData.targets || [];
		const targets = new Set([
			...existingTargets,
			...newTargets.map((token) => token.document.uuid),
		]);

		return this.update({
			system: { targets: [...targets] },
		} as Record<string, unknown>) as Promise<ChatMessage | undefined>;
	}

	#getCombatantTokenUuid(combatant: Combatant.Implementation): string | null {
		const { sceneId, tokenId } = combatant;
		if (!sceneId || !tokenId) return null;
		return `Scene.${sceneId}.Token.${tokenId}`;
	}

	#getTargetTokenDocument(targetId: string): TokenDocument | null {
		const targetDocument = fromUuidSync(targetId as `Scene.${string}.Token.${string}`);
		if (!targetDocument || !('actor' in targetDocument)) return null;
		return targetDocument as unknown as TokenDocument;
	}

	#getCombatantForTarget(tokenDocument: TokenDocument): Combatant.Implementation | null {
		const tokenCombatant = (
			tokenDocument as TokenDocument & { combatant?: Combatant.Implementation }
		).combatant;
		if (tokenCombatant) return tokenCombatant;

		const sceneId = tokenDocument.parent?.id;
		const candidates = [game.combat, game.combats?.viewed, ...(game.combats?.contents ?? [])];
		const visitedCombatIds = new Set<string>();

		for (const combat of candidates) {
			if (!combat || visitedCombatIds.has(combat.id)) continue;
			visitedCombatIds.add(combat.id);
			if (sceneId && combat.scene?.id !== sceneId) continue;

			const combatant = combat.combatants.find(
				(c) => c.tokenId === tokenDocument.id && (!sceneId || c.sceneId === sceneId),
			);
			if (combatant) return combatant;
		}

		return null;
	}

	#getDefendChoices(systemData: ActivationCardSystemData): Record<string, unknown> {
		const defendChoices = systemData.defendChoices;
		if (!defendChoices || typeof defendChoices !== 'object') return {};
		return defendChoices as Record<string, unknown>;
	}

	#getStoredDefendChoice(
		defendChoices: Record<string, unknown>,
		targetId: string,
	): DefendChoice | null {
		const value = foundry.utils.getProperty(defendChoices, targetId);
		if (value === 'yes' || value === 'no') return value;
		return null;
	}

	canTargetDefend(targetId: string): boolean {
		if (!this.isActivationCard()) return false;

		const tokenDocument = this.#getTargetTokenDocument(targetId);
		const actor = tokenDocument?.actor;
		if (!actor || actor.type !== 'character') return false;

		const combatant = this.#getCombatantForTarget(tokenDocument);
		if (!combatant) return false;

		return Boolean(foundry.utils.getProperty(combatant, 'system.actions.heroic.defendAvailable'));
	}

	canUserSetDefendChoice(targetId: string): boolean {
		if (!this.isActivationCard()) return false;
		if (!game.user) return false;
		if (game.user.isGM) return true;

		const canUpdateMessage = this.canUserModify(game.user, 'update');
		if (!canUpdateMessage) return false;

		const tokenDocument = this.#getTargetTokenDocument(targetId);
		const actor = tokenDocument?.actor;
		if (!actor || actor.type !== 'character') return false;

		return actor.testUserPermission(game.user, 'OWNER');
	}

	getDefendChoice(targetId: string): DefendChoice | null {
		if (!this.isActivationCard()) return null;

		const systemData = this.system as ActivationCardSystemData;
		const defendChoices = this.#getDefendChoices(systemData);
		return this.#getStoredDefendChoice(defendChoices, targetId);
	}

	async setDefendChoice(targetId: string, choice: DefendChoice): Promise<ChatMessage | undefined> {
		if (!this.isActivationCard()) {
			ui.notifications?.warn('Cannot set defend options for this message type.');
			return;
		}

		if (!this.canTargetDefend(targetId)) {
			ui.notifications?.warn('Defend is not available for that target.');
			return;
		}

		if (!this.canUserSetDefendChoice(targetId)) {
			ui.notifications?.warn('You do not have permission to choose Defend from this card.');
			return;
		}

		const systemData = this.system as ActivationCardSystemData;
		const defendChoices = foundry.utils.deepClone(this.#getDefendChoices(systemData)) as Record<
			string,
			unknown
		>;
		foundry.utils.setProperty(defendChoices, targetId, choice);

		return this.update({
			system: { defendChoices },
		} as Record<string, unknown>) as Promise<ChatMessage | undefined>;
	}

	async applyDamage(value: number, options: Record<string, unknown> = {}): Promise<void> {
		if (!this.isActivationCard()) return;
		if (!game.user?.isGM) {
			ui.notifications?.warn('Only a GM can apply damage from chat cards.');
			return;
		}

		const systemData = this.system as ActivationCardSystemData;
		const targets = systemData.targets || [];
		if (targets.length === 0) {
			ui.notifications?.warn('No targets selected for this card.');
			return;
		}

		const damageOptions: DamageApplicationOptions = {
			ignoreArmor: Boolean(options.ignoreArmor),
			outcome: typeof options.outcome === 'string' ? options.outcome : undefined,
		};
		const defendChoices = this.#getDefendChoices(systemData);

		for (const uuid of targets) {
			const token = this.#getTargetTokenDocument(uuid);
			if (!token) continue;

			const actor = token.actor;
			if (!actor) continue;

			const actorWithDamageMethod = actor as Actor & {
				applyDamage?: (damage: number, opts?: DamageApplicationOptions) => Promise<void>;
			};

			if (typeof actorWithDamageMethod.applyDamage !== 'function') continue;

			const targetDamageOptions: DamageApplicationOptions = {
				...damageOptions,
			};

			if (actor.type === 'character') {
				const combatant = this.#getCombatantForTarget(token);
				const defendAvailable = Boolean(
					combatant &&
						foundry.utils.getProperty(combatant, 'system.actions.heroic.defendAvailable'),
				);
				const selectedDefend = this.#getStoredDefendChoice(defendChoices, uuid) === 'yes';
				const defended = defendAvailable && selectedDefend && !damageOptions.ignoreArmor;

				// Characters only benefit from armor reduction when defend is selected and available.
				targetDamageOptions.ignoreArmor = !defended || damageOptions.ignoreArmor;

				await actorWithDamageMethod.applyDamage(value, targetDamageOptions);

				if (defended && combatant) {
					await combatant.update({
						'system.actions.heroic.defendAvailable': false,
					} as Record<string, unknown>);
				}

				continue;
			}

			await actorWithDamageMethod.applyDamage(value, targetDamageOptions);
		}
	}

	async removeTarget(targetId: string): Promise<ChatMessage | undefined> {
		if (!this.isActivationCard()) {
			ui.notifications?.warn('Cannot open a target management window for this message type.');
			return;
		}

		const systemData = this.system as ActivationCardSystemData;
		const existingTargets = systemData.targets || [];
		const targets = existingTargets.filter((id) => id !== targetId);
		const defendChoices = foundry.utils.deepClone(this.#getDefendChoices(systemData)) as Record<
			string,
			unknown
		>;

		const targetPathSegments = targetId.split('.');
		let currentNode: Record<string, unknown> | undefined = defendChoices;
		for (let index = 0; index < targetPathSegments.length - 1; index += 1) {
			const segment = targetPathSegments[index];
			const nextNode = currentNode?.[segment];
			if (!nextNode || typeof nextNode !== 'object') {
				currentNode = undefined;
				break;
			}
			currentNode = nextNode as Record<string, unknown>;
		}

		const leafSegment = targetPathSegments[targetPathSegments.length - 1];
		if (currentNode && leafSegment in currentNode) {
			delete currentNode[leafSegment];
		}

		return this.update({
			system: { targets, defendChoices },
		} as Record<string, unknown>) as Promise<ChatMessage | undefined>;
	}
}

export { NimbleChatMessage };
