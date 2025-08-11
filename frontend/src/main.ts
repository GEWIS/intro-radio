/**
 * main.ts
 *
 * Bootstraps Vuetify and other plugins then mounts the App`
 */

// Plugins
import { createApp } from 'vue';
import { registerPlugins } from '@/plugins';
import App from './App.vue';

// Components

// Composables

// Styles
import 'unfonts.css';
import '@/assets/styles.css';

const app = createApp(App);

registerPlugins(app);

app.mount('#app');
