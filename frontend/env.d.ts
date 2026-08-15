/// <reference types="vite/client" />
/// <reference types="unplugin-vue-router/client" />
/// <reference types="vite-plugin-vue-layouts-next/client" />

interface ImportMetaEnv {
  /** Git commit SHA baked in at Docker build time, see frontend/Dockerfile. */
  readonly VITE_GIT_SHA?: string;
}
