import { createVuetify } from 'vuetify';
import '@mdi/font/css/materialdesignicons.css';
import 'vuetify/styles';

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
      dark: {
        colors: {
          primary: '#FFB300',
          secondary: '#FFB300',
          accent: '#4FC3F7',
          success: '#81C784',
          info: '#FFD54F',
          background: '#121212',
          surface: '#1E1E1E',
          'on-primary': '#FFFFFF',
        },
      },
    },
  },
});
