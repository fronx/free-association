import { vitePreprocess } from '@sveltejs/vite-plugin-svelte'

export default {
  preprocess: vitePreprocess(),
  
  // Add compatibility mode to support Svelte 4's component API
  // This allows using 'new Component()' syntax from older components
  compilerOptions: {
    compatibility: {
      componentApi: 4
    }
  }
}