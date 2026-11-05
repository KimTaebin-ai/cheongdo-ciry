import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';
const chrome='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export default defineConfig({testDir:'./e2e',fullyParallel:false,use:{baseURL:'http://127.0.0.1:5173',viewport:{width:390,height:844},launchOptions:existsSync(chrome)?{executablePath:chrome}:{}},webServer:{command:'npm run dev -- --port 5173',url:'http://127.0.0.1:5173',reuseExistingServer:!process.env.CI}});
