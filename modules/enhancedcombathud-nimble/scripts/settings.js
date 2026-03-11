import { MODULE_ID, SETTINGS } from './constants.js';

function refreshArgonIfRendered() {
	if (ui?.ARGON?.rendered) {
		ui.ARGON.refresh();
	}
}

export function registerSettings() {
	game.settings.register(MODULE_ID, SETTINGS.ENABLE_PLACEHOLDERS, {
		name: 'Enable Nimble Placeholder Actions',
		hint: 'Shows placeholder HUD buttons for Nimble actions/reactions that are not fully automated yet.',
		scope: 'world',
		config: true,
		type: Boolean,
		default: true,
		onChange: refreshArgonIfRendered,
	});

	game.settings.register(MODULE_ID, SETTINGS.ENFORCE_ACTION_ECONOMY, {
		name: 'Enforce Nimble Action Economy',
		hint: 'Consumes combat actions from the selected combatant when using HUD actions and reactions.',
		scope: 'world',
		config: true,
		type: Boolean,
		default: true,
		onChange: refreshArgonIfRendered,
	});

	game.settings.register(MODULE_ID, SETTINGS.SHOW_CLASS_FEATURE_PANEL, {
		name: 'Show Class Feature Panel',
		hint: 'Shows a dedicated class feature panel that replaces traditional special-ability grouping.',
		scope: 'client',
		config: true,
		type: Boolean,
		default: true,
		onChange: refreshArgonIfRendered,
	});
}

export function getSetting(key) {
	return game.settings.get(MODULE_ID, key);
}
