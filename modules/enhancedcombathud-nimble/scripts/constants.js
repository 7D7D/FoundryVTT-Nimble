export const MODULE_ID = 'enhancedcombathud-nimble';

export const SETTINGS = {
	ENABLE_PLACEHOLDERS: 'enablePlaceholders',
	ENFORCE_ACTION_ECONOMY: 'enforceActionEconomy',
	SHOW_CLASS_FEATURE_PANEL: 'showClassFeaturePanel',
};

export const SUPPORTED_ACTOR_TYPES = ['character', 'npc', 'minion', 'soloMonster'];

export const HERO_REACTION_IDS = {
	DEFEND: 'defend',
	INTERPOSE: 'interpose',
	OPPORTUNITY_ATTACK: 'opportunityAttack',
	HELP: 'help',
};

export const COMBATANT_FLAG_KEYS = {
	REACTION_ROUND: {
		[HERO_REACTION_IDS.OPPORTUNITY_ATTACK]: 'heroicOpportunityRound',
		[HERO_REACTION_IDS.HELP]: 'heroicHelpRound',
	},
};

export const ACTIONABLE_ITEM_TYPES = new Set(['spell', 'feature', 'object', 'monsterFeature']);

export const PANEL_ICONS = {
	SPELLS: 'systems/nimble/assets/icons/charged.svg',
	FEATURES: 'systems/nimble/assets/icons/circle3.svg',
	OBJECTS: 'systems/nimble/assets/icons/d20.svg',
	CLASS_FEATURES: 'systems/nimble/assets/icons/circle5.svg',
	REACTIONS: 'systems/nimble/assets/icons/encumbered.svg',
	FREE: 'systems/nimble/assets/icons/circle1.svg',
	CREATURE: 'systems/nimble/assets/icons/dazed.svg',
};

export const HERO_ACTION_PLACEHOLDERS = [
	{
		id: 'attack',
		label: 'Attack',
		description:
			'Heroic Action placeholder. Use this when resolving a basic attack directly in chat or narration.',
		icon: 'systems/nimble/assets/icons/d20.svg',
		cost: 1,
		colorScheme: 0,
	},
	{
		id: 'move',
		label: 'Move',
		description:
			'Heroic Action placeholder. Represents spending 1 action to move up to your speed.',
		icon: 'systems/nimble/assets/icons/slowed.svg',
		cost: 1,
		colorScheme: 0,
	},
	{
		id: 'castSpell',
		label: 'Cast Spell',
		description:
			'Heroic Action placeholder. Use this when you cast a spell without clicking a specific spell item.',
		icon: 'systems/nimble/assets/icons/charged.svg',
		cost: 1,
		colorScheme: 0,
	},
	{
		id: 'assess',
		label: 'Assess',
		description:
			'Heroic Action placeholder. Use this for Ask a Question, Create an Opening, or Anticipate Danger.',
		icon: 'systems/nimble/assets/icons/dazed.svg',
		cost: 1,
		colorScheme: 0,
	},
];

export const HERO_REACTION_PLACEHOLDERS = [
	{
		id: HERO_REACTION_IDS.DEFEND,
		label: 'Defend',
		description:
			'Heroic Reaction placeholder. Reduce damage from a single attack by your armor. Costs 1 action.',
		icon: 'systems/nimble/assets/icons/encumbered.svg',
		heroicReactionId: HERO_REACTION_IDS.DEFEND,
		isReaction: true,
		colorScheme: 3,
	},
	{
		id: HERO_REACTION_IDS.INTERPOSE,
		label: 'Interpose',
		description:
			'Heroic Reaction placeholder. Move adjacent ally within 2 spaces and become the target. Costs 1 action.',
		icon: 'systems/nimble/assets/icons/grappled.svg',
		heroicReactionId: HERO_REACTION_IDS.INTERPOSE,
		isReaction: true,
		colorScheme: 3,
	},
	{
		id: HERO_REACTION_IDS.OPPORTUNITY_ATTACK,
		label: 'Opportunity Attack',
		description:
			'Heroic Reaction placeholder. Melee attack with disadvantage against adjacent enemy that moves away.',
		icon: 'systems/nimble/assets/icons/d20.svg',
		heroicReactionId: HERO_REACTION_IDS.OPPORTUNITY_ATTACK,
		isReaction: true,
		colorScheme: 3,
	},
	{
		id: HERO_REACTION_IDS.HELP,
		label: 'Help',
		description:
			'Heroic Reaction placeholder. Grant advantage when you can justify helping. Costs 1 action.',
		icon: 'systems/nimble/assets/icons/charmed.svg',
		heroicReactionId: HERO_REACTION_IDS.HELP,
		isReaction: true,
		colorScheme: 3,
	},
];

export const CREATURE_ACTION_PLACEHOLDERS = [
	{
		id: 'creatureAttack',
		label: 'Attack',
		description: 'Creature placeholder action for basic attacks.',
		icon: 'systems/nimble/assets/icons/d20.svg',
		cost: 1,
		colorScheme: 0,
	},
	{
		id: 'creatureMove',
		label: 'Move',
		description: 'Creature placeholder action for movement.',
		icon: 'systems/nimble/assets/icons/slowed.svg',
		cost: 1,
		colorScheme: 0,
	},
	{
		id: 'creatureSpecial',
		label: 'Special',
		description: 'Creature placeholder action for custom monster abilities.',
		icon: 'systems/nimble/assets/icons/circle10.svg',
		cost: 1,
		colorScheme: 0,
	},
];
