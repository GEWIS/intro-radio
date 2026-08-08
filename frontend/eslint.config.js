import { eslintConfig as prettier } from '@gewis/prettier-config';
import vuetify from 'eslint-config-vuetify';

export default vuetify(
  {
    vue: true,
  },
  prettier,
  { ignores: ['src/typed-router.d.ts', 'src/components.d.ts', 'src/auto-imports.d.ts'] },
  {
    // Pinia's options-style stores reference `this` inside plain action/getter
    // methods by design (Pinia binds it, typed via PiniaCustomProperties) -- not
    // the unsafe pattern this rule targets.
    files: ['src/stores/**/*.ts'],
    rules: { 'unicorn/no-this-outside-of-class': 'off' },
  },
);
