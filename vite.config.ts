import { defineConfig } from 'vite';

// The BeatBound Library v1 JSON files are the single source of truth for game
// data. Serving that folder as Vite's public dir means the runtime fetches the
// *same* files the designers edit -- no copies to keep in sync.
//   beatbound_library_v1/prototype_90s.level.json  ->  /prototype_90s.level.json
export default defineConfig({
  publicDir: 'beatbound_library_v1',
});
