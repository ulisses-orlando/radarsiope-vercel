import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        exposeSupabase: 'src/exposeSupabase.js'
      },
      output: {
        entryFileNames: 'exposeSupabase.js'
      }
    }
  }
})

