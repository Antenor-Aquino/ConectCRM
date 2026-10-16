/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** "1" libera o CRM sem licença (só para builds de teste). */
  readonly VITE_LICENSE_BYPASS?: string;
}
