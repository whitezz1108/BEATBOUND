import { defineConfig } from 'vite';

// The BeatBound Library v1 JSON files are the single source of truth for game
// data. Serving that folder as Vite's public dir means the runtime fetches the
// *same* files the designers edit -- no copies to keep in sync.
//   beatbound_library_v1/prototype_90s.level.json  ->  /prototype_90s.level.json
//
// `base` is the GitHub Pages project subpath: the site is served from
// https://whitezz1108.github.io/BEATBOUND/, so every emitted asset URL and every
// `import.meta.env.BASE_URL` (see src/config.ts) has to carry that prefix. It is
// '/BEATBOUND/' for builds and for `vite preview`, which serves the built output
// the same way Pages does. `npm run dev` is unaffected -- Vite rewrites the
// configured base to '/' while the dev server is running.
export default defineConfig({
  base: '/BEATBOUND/',
  publicDir: 'beatbound_library_v1',
});
