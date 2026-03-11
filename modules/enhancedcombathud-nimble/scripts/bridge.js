import {
	ACTIONABLE_ITEM_TYPES,
	CREATURE_ACTION_PLACEHOLDERS,
	HERO_ACTION_PLACEHOLDERS,
	HERO_REACTION_PLACEHOLDERS,
	MODULE_ID,
	PANEL_ICONS,
	SETTINGS,
	SUPPORTED_ACTOR_TYPES,
} from './constants.js';
import {
	canPayItemActivationCost,
	getActionsData,
	getCombatantForActor,
	getItemActivationCost,
	payItemActivationCost,
	postPlaceholderToChat,
	resetHeroicReactionAvailabilityForNewRound,
	spendHeroicReaction,
	spendTurnActions,
} from './economy.js';
import { getSetting } from './settings.js';

const refreshArgonHud = (() => {
	const refresh = () => {
		if (ui?.ARGON?.rendered) {
			ui.ARGON.refresh();
		}
	};
	return foundry.utils?.debounce ? foundry.utils.debounce(refresh, 120) : refresh;
})();

let hooksInitialized = false;
let bridgeInitialized = false;

function localizeMaybe(value) {
	if (typeof value !== 'string') return `${value ?? ''}`;
	return game.i18n?.localize?.(value) ?? value;
}

function toNumber(value, fallback = 0) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function toSigned(value) {
	const number = Math.floor(toNumber(value, 0));
	return number >= 0 ? `+${number}` : `${number}`;
}

function isCharacterActor(actor) {
	return actor?.type === 'character';
}

function isCreatureActor(actor) {
	return ['npc', 'minion', 'soloMonster'].includes(actor?.type);
}

function sortItems(items) {
	return [...items].sort(
		(a, b) =>
			toNumber(a.sort, 0) - toNumber(b.sort, 0) || (a.name ?? '').localeCompare(b.name ?? ''),
	);
}

function getActionableItems(actor) {
	if (!actor?.items) return [];
	return actor.items.filter((item) => ACTIONABLE_ITEM_TYPES.has(item.type));
}

function getWeaponItems(actor) {
	if (!actor?.items) return [];
	return sortItems(
		actor.items.filter(
			(item) => item.type === 'object' && String(item.system?.objectType ?? '') === 'weapon',
		),
	);
}

function isClassFeature(item) {
	if (item?.type !== 'feature') return false;

	const featureType = String(item.system?.featureType ?? '');
	return featureType === 'class' || Boolean(item.system?.class) || Boolean(item.system?.subclass);
}

function getItemCostKind(item) {
	const cost = getItemActivationCost(item);
	if (cost.type === 'action' && cost.isReaction) return 'reaction';
	if (cost.type === 'action') return 'action';
	if (['none', 'special', 'turn'].includes(cost.type)) return 'free';
	return 'other';
}

function formatActivationCost({ type, quantity, isReaction }) {
	if (type === 'none') return 'No action cost';
	const costQty = Math.max(1, toNumber(quantity, 1));
	const typeLabel = localizeMaybe(CONFIG.NIMBLE?.activationCostTypes?.[type] ?? type);
	const suffix = isReaction ? ' (Reaction)' : '';
	return `${costQty} ${typeLabel}${suffix}`;
}

function getFilteredItems(actor, kind, { includeClassFeatures = true } = {}) {
	let items = getActionableItems(actor).filter((item) => getItemCostKind(item) === kind);
	if (!includeClassFeatures) {
		items = items.filter((item) => !isClassFeature(item));
	}
	return sortItems(items);
}

function getClassFeatureItems(actor) {
	if (!actor?.items) return [];
	return sortItems(actor.items.filter((item) => isClassFeature(item)));
}

function getActorDescription(actor) {
	if (!actor) return '';

	if (isCharacterActor(actor)) {
		const classNames = actor.items
			.filter((item) => item.type === 'class')
			.map((item) => item.name)
			.filter(Boolean);
		const level = Math.max(1, toNumber(actor.system?.classData?.levels?.length, 1));
		const classLabel = classNames.length ? classNames.join(' / ') : 'Hero';
		return `Level ${level} ${classLabel}`;
	}

	const creatureType = String(actor.system?.details?.creatureType ?? actor.type ?? 'creature');
	const level = String(actor.system?.details?.level ?? '?');
	return `Level ${level} ${creatureType}`;
}

function getCharacterArmorValue(actor) {
	const armorValue = actor?.system?.attributes?.armor?.value;
	if (armorValue !== undefined && armorValue !== null) {
		return toNumber(armorValue, 0);
	}
	return toNumber(actor?.system?.attributes?.armor, 0);
}

async function getItemDescription(item) {
	if (!item) return '';

	let rawDescription = '';
	if (item.type === 'spell') {
		rawDescription = item.system?.description?.baseEffect ?? '';
	} else if (item.type === 'feature' || item.type === 'monsterFeature') {
		rawDescription = item.system?.description ?? '';
	} else if (item.type === 'object') {
		const isIdentified = item.system?.identified ?? true;
		rawDescription = isIdentified
			? (item.system?.description?.public ?? '')
			: (item.system?.description?.unidentified ?? '');
	} else {
		rawDescription = item.system?.description?.value ?? '';
	}

	if (!rawDescription) return '';

	try {
		return await foundry.applications.ux.TextEditor.implementation.enrichHTML(rawDescription, {
			async: true,
			relativeTo: item,
		});
	} catch (_error) {
		return rawDescription;
	}
}

function getItemSubtitle(item) {
	if (!item) return '';

	if (item.type === 'spell') {
		return `Tier ${toNumber(item.system?.tier, 0)} Spell`;
	}
	if (item.type === 'feature') {
		const featureType = String(item.system?.featureType ?? 'feature');
		const localized = localizeMaybe(CONFIG.NIMBLE?.featureTypes?.[featureType] ?? featureType);
		return localized;
	}
	if (item.type === 'monsterFeature') {
		return localizeMaybe(item.system?.subtype ?? 'Monster Feature');
	}
	if (item.type === 'object') {
		const objectType = String(item.system?.objectType ?? 'object');
		return localizeMaybe(CONFIG.NIMBLE?.objectTypes?.[objectType] ?? objectType);
	}
	return item.type;
}

function getItemProperties(item) {
	const selected = item?.system?.properties?.selected ?? [];
	return selected.map((property) => {
		const labelKey =
			CONFIG.NIMBLE?.spellProperties?.[property] ??
			CONFIG.NIMBLE?.weaponProperties?.[property] ??
			property;
		const localized = localizeMaybe(labelKey);
		return {
			label: localized,
			secondary: true,
		};
	});
}

async function buildItemTooltipData(item) {
	if (!item) return null;

	const description = await getItemDescription(item);
	const cost = getItemActivationCost(item);
	const details = [
		{
			label: 'Cost',
			value: formatActivationCost(cost),
		},
	];

	const targetCount = toNumber(item.system?.activation?.targets?.count, 0);
	if (targetCount > 0) {
		details.push({
			label: 'Targets',
			value: targetCount,
		});
	}

	const attackType = item.system?.activation?.targets?.attackType;
	const distance = toNumber(item.system?.activation?.targets?.distance, 0);
	if (attackType && distance > 0) {
		details.push({
			label: 'Range',
			value: `${attackType} ${distance}`,
		});
	}

	if (item.type === 'spell') {
		const tier = toNumber(item.system?.tier, 0);
		const manaCost = tier > 0 ? tier : 0;
		details.push({
			label: 'Mana',
			value: manaCost,
		});
	}

	return {
		title: item.name,
		subtitle: getItemSubtitle(item),
		description,
		details,
		propertiesLabel: 'Properties',
		properties: getItemProperties(item),
		footerText: [],
	};
}

function buildPlaceholderTooltip(definition) {
	const costLabel = definition.isReaction
		? '1 action (reaction)'
		: `${definition.cost ?? 1} action`;
	return {
		title: definition.label,
		subtitle: 'Nimble Placeholder',
		description: definition.description,
		details: [
			{
				label: 'Cost',
				value: costLabel,
			},
		],
		propertiesLabel: 'Status',
		properties: [{ label: 'Placeholder', secondary: true }],
		footerText: [],
	};
}

function createPanelButtonClass(ARGON, NimbleItemButton) {
	return class NimbleButtonPanelButton extends ARGON.MAIN.BUTTONS.ButtonPanelButton {
		constructor({ id, label, icon, color = 0, items = [] }) {
			super();
			this.panelId = id;
			this.panelLabel = label;
			this.panelIcon = icon;
			this.panelColor = color;
			this.items = sortItems(items);
		}

		get id() {
			return this.panelId;
		}

		get hasContents() {
			return this.items.length > 0;
		}

		get label() {
			return this.panelLabel;
		}

		get icon() {
			return this.panelIcon;
		}

		get colorScheme() {
			return this.panelColor;
		}

		async _getPanel() {
			return new ARGON.MAIN.BUTTON_PANELS.ButtonPanel({
				id: this.id,
				buttons: this.items.map((item) => new NimbleItemButton({ item })),
			});
		}
	};
}

function createPlaceholderButtonClass(ARGON) {
	return class NimblePlaceholderActionButton extends ARGON.MAIN.BUTTONS.ActionButton {
		constructor(definition) {
			super();
			this.definition = definition;
		}

		get label() {
			return this.definition.label;
		}

		get icon() {
			return this.definition.icon;
		}

		get colorScheme() {
			return this.definition.colorScheme ?? (this.definition.isReaction ? 3 : 0);
		}

		get hasTooltip() {
			return true;
		}

		async getTooltipData() {
			return buildPlaceholderTooltip(this.definition);
		}

		async _onLeftClick(_event) {
			if (!this.actor) return;

			let spent = true;
			if (this.definition.heroicReactionId) {
				spent = await spendHeroicReaction(this.actor, this.definition.heroicReactionId);
			} else {
				spent = await spendTurnActions(this.actor, this.definition.cost ?? 1);
			}
			if (!spent) return;

			await postPlaceholderToChat({
				actor: this.actor,
				title: this.definition.label,
				description: this.definition.description,
				isReaction: Boolean(this.definition.isReaction),
			});
			refreshArgonHud();
		}

		async _renderInner(...args) {
			await super._renderInner(...args);
			this.element.classList.add('nimble-placeholder');
			if (this.definition.isReaction) {
				this.element.classList.add('nimble-reaction-placeholder');
			}
		}
	};
}

function createItemButtonClass(ARGON) {
	return class NimbleItemButton extends ARGON.MAIN.BUTTONS.ItemButton {
		get hasTooltip() {
			return Boolean(this.item);
		}

		get colorScheme() {
			const cost = getItemActivationCost(this.item);
			if (cost.type === 'action' && cost.isReaction) return 3;
			if (cost.type !== 'action') return 2;
			return null;
		}

		get quantity() {
			if (!this.item) return null;

			if (this.item.type === 'object') {
				const quantity = toNumber(this.item.system?.quantity, NaN);
				return Number.isFinite(quantity) ? quantity : null;
			}

			if (this.item.type === 'spell') {
				const mana = toNumber(this.actor?.system?.resources?.mana?.current, NaN);
				return Number.isFinite(mana) ? mana : null;
			}

			return null;
		}

		get ranges() {
			const targets = this.item?.system?.activation?.targets ?? {};
			const distance = toNumber(targets.distance, 0);
			if (!targets.attackType || distance <= 0) {
				return super.ranges;
			}

			return {
				normal: distance,
				long: null,
			};
		}

		get targets() {
			const count = toNumber(this.item?.system?.activation?.targets?.count, 0);
			return count > 0 ? count : 0;
		}

		async getTooltipData() {
			return buildItemTooltipData(this.item);
		}

		async _onLeftClick(_event) {
			if (!this.item || !this.actor) return;

			if (!canPayItemActivationCost(this.actor, this.item)) return;

			let result;
			try {
				result = await this.actor.activateItem?.(this.item.id, {});
			} catch (error) {
				console.error('Nimble Argon | Item activation failed.', error);
				ui.notifications?.error(`Could not activate ${this.item.name}.`);
				return;
			}

			if (result === null) return;

			await payItemActivationCost(this.actor, this.item, { quiet: true });
			refreshArgonHud();
		}

		async _onRightClick(_event) {
			this.item?.sheet?.render(true);
		}

		async _renderInner(...args) {
			await super._renderInner(...args);
			const isReactionItem = Boolean(getItemActivationCost(this.item).isReaction);
			this.element.classList.toggle('nimble-item-reaction', isReactionItem);
		}
	};
}

function registerWithCoreHud(CoreHUD) {
	if (bridgeInitialized) return;
	bridgeInitialized = true;

	const ARGON = CoreHUD.ARGON;
	const NimbleItemButton = createItemButtonClass(ARGON);
	const NimbleButtonPanelButton = createPanelButtonClass(ARGON, NimbleItemButton);
	const NimblePlaceholderActionButton = createPlaceholderButtonClass(ARGON);

	function createItemPanelButton({ id, label, icon, color, items }) {
		if (!items.length) return null;
		return new NimbleButtonPanelButton({
			id,
			label,
			icon,
			color,
			items,
		});
	}

	class NimbleTooltip extends ARGON.CORE.Tooltip {
		get classes() {
			return [...super.classes, 'nimble-argon-tooltip'];
		}
	}

	class NimblePortraitPanel extends ARGON.PORTRAIT.PortraitPanel {
		get description() {
			return getActorDescription(this.actor);
		}

		get isDead() {
			if (isCharacterActor(this.actor)) {
				const woundsValue = toNumber(this.actor?.system?.attributes?.wounds?.value, 0);
				const woundsMax = toNumber(this.actor?.system?.attributes?.wounds?.max, 0);
				return woundsMax > 0 && woundsValue >= woundsMax;
			}
			return toNumber(this.actor?.system?.attributes?.hp?.value, 0) <= 0;
		}

		get isDying() {
			return false;
		}

		async _onDeathSave(_event) {
			ui.notifications?.info('Nimble does not use D&D 5e death saves.');
		}

		async getStatBlocks() {
			const hpValue = toNumber(this.actor?.system?.attributes?.hp?.value, 0);
			const hpTemp = toNumber(this.actor?.system?.attributes?.hp?.temp, 0);
			const hpMax = toNumber(this.actor?.system?.attributes?.hp?.max, 0);
			const armorValue = getCharacterArmorValue(this.actor);

			const hpColor = hpTemp > 0 ? '#6ca0ff' : 'rgb(0 255 170)';
			const blocks = [
				[
					{ text: `${hpValue + hpTemp}`, color: hpColor },
					{ text: '/' },
					{ text: `${hpMax}` },
					{ text: 'HP' },
				],
				[
					{ text: 'Armor' },
					{ text: `${armorValue}`, color: 'var(--ech-movement-baseMovement-background)' },
				],
			];

			if (isCharacterActor(this.actor)) {
				const manaCurrent = toNumber(this.actor?.system?.resources?.mana?.current, 0);
				const manaMax = toNumber(this.actor?.system?.resources?.mana?.max, 0);
				const woundsValue = toNumber(this.actor?.system?.attributes?.wounds?.value, 0);
				const woundsMax = toNumber(this.actor?.system?.attributes?.wounds?.max, 0);

				blocks.push([
					{ text: 'Mana' },
					{ text: `${manaCurrent}/${manaMax}`, color: 'rgb(126 199 255)' },
				]);
				blocks.push([
					{ text: 'Wounds' },
					{ text: `${woundsValue}/${woundsMax}`, color: 'rgb(255 128 128)' },
				]);
			}

			return blocks;
		}
	}

	class NimbleDrawerButton extends ARGON.DRAWER.DrawerButton {
		constructor(buttons, tooltipData = null) {
			super(buttons);
			this.tooltipData = tooltipData;
		}

		get hasTooltip() {
			return Boolean(this.tooltipData);
		}

		async getTooltipData() {
			return this.tooltipData;
		}
	}

	class NimbleDrawerPanel extends ARGON.DRAWER.DrawerPanel {
		get title() {
			return isCharacterActor(this.actor) ? 'Checks / Skills' : 'Saving Throws';
		}

		get categories() {
			const categories = [];
			const abilityButtons = this.getAbilityButtons();
			const skillButtons = this.getSkillButtons();
			const saveButtons = this.getSaveButtons();

			if (abilityButtons.length > 0) {
				categories.push({
					gridCols: '5fr 2fr 2fr',
					captions: [
						{ label: 'Abilities', align: 'left' },
						{ label: 'Check', align: 'center' },
						{ label: 'Save', align: 'center' },
					],
					buttons: abilityButtons,
				});
			}

			if (skillButtons.length > 0) {
				categories.push({
					gridCols: '7fr 2fr',
					captions: [
						{ label: 'Skills', align: 'left' },
						{ label: 'Mod', align: 'center' },
					],
					buttons: skillButtons,
				});
			}

			if (saveButtons.length > 0 && abilityButtons.length === 0) {
				categories.push({
					gridCols: '7fr 2fr',
					captions: [
						{ label: 'Saving Throws', align: 'left' },
						{ label: 'Mod', align: 'center' },
					],
					buttons: saveButtons,
				});
			}

			return categories;
		}

		getAbilityButtons() {
			const abilities = this.actor?.system?.abilities ?? {};
			const saves = this.actor?.system?.savingThrows ?? {};

			return Object.entries(abilities).map(([abilityKey, abilityData]) => {
				const abilityLabel = localizeMaybe(
					CONFIG.NIMBLE?.abilityScores?.[abilityKey] ?? abilityKey,
				);
				const checkValue = toSigned(abilityData?.mod ?? 0);
				const saveValue = toSigned(saves?.[abilityKey]?.mod ?? 0);

				return new NimbleDrawerButton(
					[
						{
							label: abilityLabel,
							onClick: () => this.actor.rollAbilityCheckToChat?.(abilityKey),
						},
						{
							label: checkValue,
							onClick: () => this.actor.rollAbilityCheckToChat?.(abilityKey),
						},
						{
							label: saveValue,
							onClick: () => this.actor.rollSavingThrowToChat?.(abilityKey),
						},
					],
					{
						title: abilityLabel,
						subtitle: 'Ability',
						description: `${abilityLabel} checks and saves.`,
						details: [],
						properties: [],
						footerText: [],
					},
				);
			});
		}

		getSkillButtons() {
			if (!isCharacterActor(this.actor)) return [];

			const skills = this.actor?.system?.skills ?? {};
			return Object.entries(skills).map(([skillKey, skillData]) => {
				const skillLabel = localizeMaybe(CONFIG.NIMBLE?.skills?.[skillKey] ?? skillKey);
				return new NimbleDrawerButton(
					[
						{
							label: skillLabel,
							onClick: () => this.actor.rollSkillCheckToChat?.(skillKey),
						},
						{
							label: toSigned(skillData?.mod ?? 0),
							onClick: () => this.actor.rollSkillCheckToChat?.(skillKey),
						},
					],
					{
						title: skillLabel,
						subtitle: 'Skill',
						description: `${skillLabel} skill checks.`,
						details: [],
						properties: [],
						footerText: [],
					},
				);
			});
		}

		getSaveButtons() {
			const saves = this.actor?.system?.savingThrows ?? {};
			return Object.entries(saves).map(([saveKey, saveData]) => {
				const label = localizeMaybe(CONFIG.NIMBLE?.savingThrows?.[saveKey] ?? saveKey);
				return new NimbleDrawerButton(
					[
						{
							label,
							onClick: () => this.actor.rollSavingThrowToChat?.(saveKey),
						},
						{
							label: toSigned(saveData?.mod ?? 0),
							onClick: () => this.actor.rollSavingThrowToChat?.(saveKey),
						},
					],
					{
						title: label,
						subtitle: 'Save',
						description: `${label} saving throws.`,
						details: [],
						properties: [],
						footerText: [],
					},
				);
			});
		}
	}

	class NimbleHeroActionsPanel extends ARGON.MAIN.ActionPanel {
		get label() {
			return 'Hero Actions';
		}

		get maxActions() {
			if (!isCharacterActor(this.actor)) return null;
			const combatant = getCombatantForActor(this.actor);
			if (!combatant?.parent?.started) return null;
			return getActionsData(combatant).max;
		}

		get currentActions() {
			if (!isCharacterActor(this.actor)) return null;
			const combatant = getCombatantForActor(this.actor);
			if (!combatant?.parent?.started) return null;
			return getActionsData(combatant).current;
		}

		async _getButtons() {
			if (!isCharacterActor(this.actor)) return [];

			const buttons = [];
			if (getWeaponItems(this.actor).length > 0) {
				buttons.push(new NimbleItemButton({ item: null, isWeaponSet: true, isPrimary: true }));
			}

			if (getSetting(SETTINGS.ENABLE_PLACEHOLDERS)) {
				for (const definition of HERO_ACTION_PLACEHOLDERS) {
					buttons.push(new NimblePlaceholderActionButton(definition));
				}
			}

			const actionItems = getFilteredItems(this.actor, 'action', { includeClassFeatures: false });
			const spellItems = actionItems.filter((item) => item.type === 'spell');
			const featureItems = actionItems.filter(
				(item) => item.type === 'feature' || item.type === 'monsterFeature',
			);
			const objectItems = actionItems.filter((item) => item.type === 'object');

			const spellButton = createItemPanelButton({
				id: 'nimble-action-spells',
				label: 'Spells',
				icon: PANEL_ICONS.SPELLS,
				color: 0,
				items: spellItems,
			});
			const featureButton = createItemPanelButton({
				id: 'nimble-action-features',
				label: 'Abilities',
				icon: PANEL_ICONS.FEATURES,
				color: 0,
				items: featureItems,
			});
			const objectButton = createItemPanelButton({
				id: 'nimble-action-objects',
				label: 'Gear',
				icon: PANEL_ICONS.OBJECTS,
				color: 0,
				items: objectItems,
			});

			if (spellButton?.hasContents) buttons.push(spellButton);
			if (featureButton?.hasContents) buttons.push(featureButton);
			if (objectButton?.hasContents) buttons.push(objectButton);

			return buttons;
		}
	}

	class NimbleHeroicReactionsPanel extends ARGON.MAIN.ActionPanel {
		get label() {
			return 'Heroic Reactions';
		}

		get maxActions() {
			if (!isCharacterActor(this.actor)) return null;
			const combatant = getCombatantForActor(this.actor);
			if (!combatant?.parent?.started) return null;
			return getActionsData(combatant).max;
		}

		get currentActions() {
			if (!isCharacterActor(this.actor)) return null;
			const combatant = getCombatantForActor(this.actor);
			if (!combatant?.parent?.started) return null;
			return getActionsData(combatant).current;
		}

		async _getButtons() {
			if (!isCharacterActor(this.actor)) return [];

			const buttons = [];
			if (getWeaponItems(this.actor).length > 0) {
				buttons.push(new NimbleItemButton({ item: null, isWeaponSet: true, isPrimary: true }));
			}

			if (getSetting(SETTINGS.ENABLE_PLACEHOLDERS)) {
				for (const definition of HERO_REACTION_PLACEHOLDERS) {
					buttons.push(new NimblePlaceholderActionButton(definition));
				}
			}

			const reactionItems = getFilteredItems(this.actor, 'reaction');
			const spellItems = reactionItems.filter((item) => item.type === 'spell');
			const featureItems = reactionItems.filter(
				(item) => item.type === 'feature' || item.type === 'monsterFeature',
			);
			const objectItems = reactionItems.filter((item) => item.type === 'object');

			const spellButton = createItemPanelButton({
				id: 'nimble-reaction-spells',
				label: 'Reaction Spells',
				icon: PANEL_ICONS.SPELLS,
				color: 3,
				items: spellItems,
			});
			const featureButton = createItemPanelButton({
				id: 'nimble-reaction-features',
				label: 'Reaction Abilities',
				icon: PANEL_ICONS.REACTIONS,
				color: 3,
				items: featureItems,
			});
			const objectButton = createItemPanelButton({
				id: 'nimble-reaction-objects',
				label: 'Reaction Gear',
				icon: PANEL_ICONS.OBJECTS,
				color: 3,
				items: objectItems,
			});

			if (spellButton?.hasContents) buttons.push(spellButton);
			if (featureButton?.hasContents) buttons.push(featureButton);
			if (objectButton?.hasContents) buttons.push(objectButton);

			return buttons;
		}
	}

	class NimbleFreeActionPanel extends ARGON.MAIN.ActionPanel {
		get label() {
			return 'Free / Special';
		}

		get maxActions() {
			return null;
		}

		get currentActions() {
			return null;
		}

		async _getButtons() {
			const items = getActionableItems(this.actor).filter((item) =>
				['free', 'other'].includes(getItemCostKind(item)),
			);
			const sorted = sortItems(items);
			if (!sorted.length) return [];

			const spellItems = sorted.filter((item) => item.type === 'spell');
			const featureItems = sorted.filter(
				(item) => item.type === 'feature' || item.type === 'monsterFeature',
			);
			const objectItems = sorted.filter((item) => item.type === 'object');

			const buttons = [];
			const spellButton = createItemPanelButton({
				id: 'nimble-free-spells',
				label: 'Utility Spells',
				icon: PANEL_ICONS.SPELLS,
				color: 2,
				items: spellItems,
			});
			const featureButton = createItemPanelButton({
				id: 'nimble-free-features',
				label: 'Free Features',
				icon: PANEL_ICONS.FREE,
				color: 2,
				items: featureItems,
			});
			const objectButton = createItemPanelButton({
				id: 'nimble-free-objects',
				label: 'Free Gear',
				icon: PANEL_ICONS.OBJECTS,
				color: 2,
				items: objectItems,
			});

			if (spellButton?.hasContents) buttons.push(spellButton);
			if (featureButton?.hasContents) buttons.push(featureButton);
			if (objectButton?.hasContents) buttons.push(objectButton);

			return buttons;
		}
	}

	class NimbleClassFeaturesPanel extends ARGON.MAIN.ActionPanel {
		get label() {
			return 'Class Features';
		}

		get maxActions() {
			return null;
		}

		get currentActions() {
			return null;
		}

		async _getButtons() {
			if (!isCharacterActor(this.actor)) return [];
			if (!getSetting(SETTINGS.SHOW_CLASS_FEATURE_PANEL)) return [];

			const classFeatures = getClassFeatureItems(this.actor);
			if (!classFeatures.length) return [];

			const actionFeatures = classFeatures.filter((item) => getItemCostKind(item) === 'action');
			const reactionFeatures = classFeatures.filter((item) => getItemCostKind(item) === 'reaction');
			const passiveFeatures = classFeatures.filter(
				(item) => !['action', 'reaction'].includes(getItemCostKind(item)),
			);

			const buttons = [];
			const actionButton = createItemPanelButton({
				id: 'nimble-class-actions',
				label: 'Class Actions',
				icon: PANEL_ICONS.CLASS_FEATURES,
				color: 0,
				items: actionFeatures,
			});
			const reactionButton = createItemPanelButton({
				id: 'nimble-class-reactions',
				label: 'Class Reactions',
				icon: PANEL_ICONS.REACTIONS,
				color: 3,
				items: reactionFeatures,
			});
			const passiveButton = createItemPanelButton({
				id: 'nimble-class-passives',
				label: 'Class Passives',
				icon: PANEL_ICONS.FREE,
				color: 2,
				items: passiveFeatures,
			});

			if (actionButton?.hasContents) buttons.push(actionButton);
			if (reactionButton?.hasContents) buttons.push(reactionButton);
			if (passiveButton?.hasContents) buttons.push(passiveButton);

			return buttons;
		}
	}

	class NimbleCreatureActionsPanel extends ARGON.MAIN.ActionPanel {
		get label() {
			return 'Creature Actions';
		}

		get maxActions() {
			if (!isCreatureActor(this.actor)) return null;
			const combatant = getCombatantForActor(this.actor);
			if (!combatant?.parent?.started) return null;
			return getActionsData(combatant).max;
		}

		get currentActions() {
			if (!isCreatureActor(this.actor)) return null;
			const combatant = getCombatantForActor(this.actor);
			if (!combatant?.parent?.started) return null;
			return getActionsData(combatant).current;
		}

		async _getButtons() {
			if (!isCreatureActor(this.actor)) return [];

			const buttons = [];
			if (getWeaponItems(this.actor).length > 0) {
				buttons.push(new NimbleItemButton({ item: null, isWeaponSet: true, isPrimary: true }));
			}

			if (getSetting(SETTINGS.ENABLE_PLACEHOLDERS)) {
				for (const definition of CREATURE_ACTION_PLACEHOLDERS) {
					buttons.push(new NimblePlaceholderActionButton(definition));
				}
			}

			const actionItems = getFilteredItems(this.actor, 'action');
			const reactionItems = getFilteredItems(this.actor, 'reaction');

			const actionButton = createItemPanelButton({
				id: 'nimble-creature-actions',
				label: 'Actions',
				icon: PANEL_ICONS.CREATURE,
				color: 0,
				items: actionItems,
			});
			const reactionButton = createItemPanelButton({
				id: 'nimble-creature-reactions',
				label: 'Reactions',
				icon: PANEL_ICONS.REACTIONS,
				color: 3,
				items: reactionItems,
			});

			if (actionButton?.hasContents) buttons.push(actionButton);
			if (reactionButton?.hasContents) buttons.push(reactionButton);

			return buttons;
		}
	}

	class NimbleMovementHud extends ARGON.MovementHud {
		get movementMax() {
			if (!this.actor) return 0;
			const movement = this.actor.system?.attributes?.movement ?? {};
			const mode = this.movementMode in movement ? this.movementMode : 'walk';
			return Math.max(0, toNumber(movement[mode] ?? movement.walk, 0));
		}
	}

	class NimbleButtonHud extends ARGON.ButtonHud {
		get visible() {
			return !game.combat?.started;
		}

		async _getButtons() {
			const buttons = [
				{
					label: 'Open Sheet',
					icon: 'fas fa-id-card',
					onClick: () => this.actor?.sheet?.render(true),
				},
			];

			if (typeof this.actor?.configureMovement === 'function') {
				buttons.push({
					label: 'Movement',
					icon: 'fas fa-person-walking',
					onClick: () => this.actor.configureMovement(),
				});
			}

			if (isCharacterActor(this.actor) && typeof this.actor?.triggerRest === 'function') {
				buttons.push({
					label: 'Field Rest',
					icon: 'fas fa-hourglass-half',
					onClick: () => this.actor.triggerRest({ restType: 'field' }),
				});
				buttons.push({
					label: 'Safe Rest',
					icon: 'fas fa-moon',
					onClick: () => this.actor.triggerRest({ restType: 'safe' }),
				});
			}

			return buttons;
		}
	}

	class NimbleWeaponSets extends ARGON.WeaponSets {
		async getDefaultSets() {
			const sets = await super.getDefaultSets();
			const weapons = getWeaponItems(this.actor);
			return {
				1: {
					primary: weapons[0]?.uuid ?? sets[1]?.primary ?? null,
					secondary: weapons[1]?.uuid ?? sets[1]?.secondary ?? null,
				},
				2: {
					primary: weapons[2]?.uuid ?? sets[2]?.primary ?? null,
					secondary: weapons[3]?.uuid ?? sets[2]?.secondary ?? null,
				},
				3: {
					primary: weapons[4]?.uuid ?? sets[3]?.primary ?? null,
					secondary: weapons[5]?.uuid ?? sets[3]?.secondary ?? null,
				},
			};
		}

		async _onSetChange(_setData) {
			return;
		}
	}

	const mainPanels = [
		NimbleHeroActionsPanel,
		NimbleHeroicReactionsPanel,
		NimbleFreeActionPanel,
		NimbleClassFeaturesPanel,
		NimbleCreatureActionsPanel,
		ARGON.PREFAB.PassTurnPanel,
	];

	CoreHUD.definePortraitPanel(NimblePortraitPanel);
	CoreHUD.defineDrawerPanel(NimbleDrawerPanel);
	CoreHUD.defineMainPanels(mainPanels);
	CoreHUD.defineMovementHud(NimbleMovementHud);
	CoreHUD.defineButtonHud(NimbleButtonHud);
	CoreHUD.defineWeaponSets(NimbleWeaponSets);
	CoreHUD.defineTooltip(NimbleTooltip);
	CoreHUD.defineSupportedActorTypes(SUPPORTED_ACTOR_TYPES);
}

function actorMatchesArgon(actorId) {
	return Boolean(actorId && ui?.ARGON?._actor?.id === actorId);
}

function refreshIfActorMatches(actorId) {
	if (actorMatchesArgon(actorId)) {
		refreshArgonHud();
	}
}

export function initNimbleArgonBridge() {
	if (hooksInitialized) return;
	hooksInitialized = true;

	Hooks.on('argonInit', (CoreHUD) => {
		if (game.system.id !== 'nimble') return;
		registerWithCoreHud(CoreHUD);
	});

	Hooks.on('updateCombat', (combat, changes) => {
		void resetHeroicReactionAvailabilityForNewRound(combat, changes);

		const activeActorId = ui?.ARGON?._actor?.id;
		if (!activeActorId) return;

		const actorInCombat = combat?.combatants?.some(
			(combatant) => combatant.actor?.id === activeActorId,
		);
		if (!actorInCombat) return;

		const turnChanged = Object.hasOwn(changes ?? {}, 'turn');
		const roundChanged = Object.hasOwn(changes ?? {}, 'round');
		if (turnChanged || roundChanged) {
			refreshArgonHud();
		}
	});

	Hooks.on('updateCombatant', (combatant, changes) => {
		if (!actorMatchesArgon(combatant?.actor?.id)) return;

		const hasActionChange = Boolean(changes?.system?.actions);
		const defeatedChanged = Object.hasOwn(changes ?? {}, 'defeated');
		if (hasActionChange || defeatedChanged) {
			refreshArgonHud();
		}
	});

	Hooks.on('createCombatant', (combatant) => {
		refreshIfActorMatches(combatant?.actor?.id);
	});

	Hooks.on('deleteCombatant', (combatant) => {
		refreshIfActorMatches(combatant?.actor?.id);
	});

	Hooks.on('updateItem', (item) => {
		refreshIfActorMatches(item?.parent?.id ?? item?.actor?.id);
	});

	Hooks.on('createItem', (item) => {
		refreshIfActorMatches(item?.parent?.id ?? item?.actor?.id);
	});

	Hooks.on('deleteItem', (item) => {
		refreshIfActorMatches(item?.parent?.id ?? item?.actor?.id);
	});

	Hooks.on('updateActor', (actor) => {
		refreshIfActorMatches(actor?.id);
	});

	Hooks.on('deleteCombat', () => {
		refreshArgonHud();
	});
}
