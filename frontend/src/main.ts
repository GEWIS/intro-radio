import { createApp } from 'vue';
import { registerPlugins } from '@/plugins';
import { useAppStore } from '@/stores/app.ts';

import App from './App.vue';
import 'unfonts.css';
import '@/assets/styles.css';

const app = createApp(App);

registerPlugins(app);
const appStore = useAppStore();
appStore.fetchRadioInfo().then(() => {
  app.mount('#app');
});
