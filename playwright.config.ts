import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/browser',use:{baseURL:'http://127.0.0.1:5173',headless:true},webServer:{command:'node --import tsx server/local.ts & npx vite --host 127.0.0.1',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI},workers:1});
