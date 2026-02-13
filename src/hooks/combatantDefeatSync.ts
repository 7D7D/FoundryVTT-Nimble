type ActorWithHp = Actor.Implementation & {
	system: {
		attributes?: {
			hp?: {
				value?: number;
			};
		};
	};
};

type CombatantWithActions = Combatant.Implementation & {
	system: {
		actions?: {
			base?: {
				current?: number;
			};
		};
	};
};

function getActorHpValue(actor: ActorWithHp): number | null {
	const hpValue = actor.system?.attributes?.hp?.value;
	if (typeof hpValue !== 'number' || Number.isNaN(hpValue)) return null;
	return hpValue;
}

function getCombatantsForActor(
	actorId: string,
): Array<{ combat: Combat; combatant: CombatantWithActions }> {
	const entries: Array<{ combat: Combat; combatant: CombatantWithActions }> = [];
	for (const combat of game.combats?.contents ?? []) {
		for (const combatant of combat.combatants.contents) {
			if (combatant.actorId !== actorId) continue;
			entries.push({ combat, combatant: combatant as CombatantWithActions });
		}
	}
	return entries;
}

async function syncActorCombatantDeathState(actor: ActorWithHp): Promise<void> {
	if (!game.user?.isGM) return;

	const hpValue = getActorHpValue(actor);
	if (hpValue === null) return;

	const shouldBeDefeated = hpValue <= 0;
	if (!shouldBeDefeated) return;

	const matches = getCombatantsForActor(actor.id ?? '');
	if (matches.length === 0) return;
	const impactedCombats = new Map<string, Combat>();
	for (const { combat } of matches) {
		if (!combat.id) continue;
		impactedCombats.set(combat.id, combat);
	}

	const updatesByCombat = new Map<string, { combat: Combat; updates: Record<string, unknown>[] }>();

	for (const { combat, combatant } of matches) {
		if (combatant.type === 'character') continue;

		const update: Record<string, unknown> = { _id: combatant.id };
		let hasChanges = false;

		if (!combatant.defeated) {
			update.defeated = true;
			hasChanges = true;
		}

		const currentActions = Number(combatant.system?.actions?.base?.current ?? 0);
		if (Number.isFinite(currentActions) && currentActions !== 0) {
			update['system.actions.base.current'] = 0;
			hasChanges = true;
		}

		if (!hasChanges) continue;

		if (!combat.id) continue;

		if (!updatesByCombat.has(combat.id)) {
			updatesByCombat.set(combat.id, { combat, updates: [] });
		}
		updatesByCombat.get(combat.id)?.updates.push(update);
	}

	for (const { combat, updates } of updatesByCombat.values()) {
		if (updates.length > 0) {
			await combat.updateEmbeddedDocuments('Combatant', updates);
		}
	}

	if (matches.some(({ combatant }) => combatant.type !== 'character')) {
		const defeatedStatusId = CONFIG.specialStatusEffects.DEFEATED;
		await actor.toggleStatusEffect(defeatedStatusId, {
			overlay: true,
			active: true,
		});
	}

	for (const combat of impactedCombats.values()) {
		const activeCombatant = combat.combatant;
		if (
			!activeCombatant ||
			activeCombatant.actorId !== actor.id ||
			activeCombatant.type === 'character'
		) {
			continue;
		}

		if (combat.round > 0) {
			await combat.nextTurn();
		}
	}
}

export default function registerCombatantDefeatSync() {
	Hooks.on(
		'updateActor',
		(actor: Actor.Implementation, changes: Record<string, unknown>, _options) => {
			const hpChanged = foundry.utils.hasProperty(changes, 'system.attributes.hp.value');
			if (!hpChanged) return;

			void syncActorCombatantDeathState(actor as ActorWithHp);
		},
	);

	Hooks.on('createCombatant', (combatant: Combatant.Implementation) => {
		const actor = combatant.actor as ActorWithHp | null;
		if (!actor) return;

		void syncActorCombatantDeathState(actor);
	});
}
