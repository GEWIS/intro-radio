import { eslintConfig as prettier } from '@gewis/prettier-config';
import vuetify from 'eslint-config-vuetify';

export default vuetify(
  {
    vue: true,
  },
  prettier,
  { ignores: ['src/typed-router.d.ts', 'src/components.d.ts', 'src/auto-imports.d.ts'] },
);
