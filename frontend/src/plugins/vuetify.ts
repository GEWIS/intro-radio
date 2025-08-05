/**
 * plugins/vuetify.ts
 *
 * Framework documentation: https://vuetifyjs.com`
 */

// Styles
import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';

// Composables
import { createVuetify } from 'vuetify';

// https://vuetifyjs.com/en/introduction/why-vuetify/#feature-guides
export default createVuetify({
  theme: {
    defaultTheme: 'light',
    themes: {
      light: {
        colors: {
          primary: '#FFB300',
          secondary: '#FFB300',
          accent: '#4FC3F7',
          success: '#81C784',
          info: '#FFD54F',
          background: '#F9F6F2',
          surface: '#FFFDF8',
        },
      },
    },
  },
})
