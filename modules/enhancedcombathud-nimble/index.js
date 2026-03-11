import { initNimbleArgonBridge } from './scripts/bridge.js';
import { registerSettings } from './scripts/settings.js';

Hooks.on('setup', () => {
	registerSettings();
	initNimbleArgonBridge();
});
