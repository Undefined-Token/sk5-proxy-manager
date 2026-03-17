const { defineConfig } = require('vite')

module.exports = defineConfig({
    build: {
        outDir: 'dist',
        emptyOutDir: true,
        ssr: 'server.js',
        rollupOptions: {
            output: {
                format: 'cjs',
                entryFileNames: 'server.js',
                chunkFileNames: 'chunks/[name]-[hash].js',
                assetFileNames: 'assets/[name]-[hash][extname]',
            }
        }
    },
    ssr: {
        // 打成单文件：尽量把依赖也打进去
        noExternal: true,
    },
})

