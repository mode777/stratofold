/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SF_BASE_URL?: string;
  readonly VITE_SF_TOKEN?: string;
  readonly VITE_SF_VDIR?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
