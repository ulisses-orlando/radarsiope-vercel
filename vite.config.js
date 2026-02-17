import { defineConfig } from 'vite'

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        exposeSupabase: 'src/exposeSupabase.js',
        exposeSupabaseAdmin: 'src/exposeSupabaseAdmin.js'
      },
      output: {
        entryFileNames: '[name].js'
      }
    }
  }
})
