/**
 * plugins/index.ts
 *
 * Automatically included in `./src/main.ts`
 */

// Plugins
import type { App } from 'vue';
import router from '../router';
import pinia from '../stores';
import vuetify from './vuetify';

// Types

export function registerPlugins(app: App) {
  app.use(vuetify).use(router).use(pinia);
}
