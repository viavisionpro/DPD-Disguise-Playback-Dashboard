import {defineConfig} from 'vite';
import vue from '@vitejs/plugin-vue';
export default defineConfig({
 base:'./',define:{__VUE_OPTIONS_API__:false,__VUE_PROD_DEVTOOLS__:false,__VUE_PROD_HYDRATION_MISMATCH_DETAILS__:false},plugins:[vue({template:{transformAssetUrls:false}})],
 build:{outDir:'../DPD/vue',emptyOutDir:true,target:'es2020',minify:true,
  rollupOptions:{input:'src/main.js',output:{entryFileNames:'app.js',assetFileNames:'[name][extname]',chunkFileNames:'[name]-[hash].js'}}}
});
