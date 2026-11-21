import { defineConfig } from '@playwright/test';

// E2E gegen einen lokalen Supabase-Stack (npx supabase start) und den
// Produktions-Build (damit auch der Service Worker aktiv ist).
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 90_000,
  expect: { timeout: 10_000 },
  workers: 1,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    viewport: { width: 393, height: 852 }, // iPhone 15
    isMobile: true,
    hasTouch: true,
    locale: 'de-DE',
    actionTimeout: 15_000,
    launchOptions: process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
  },
  webServer: {
    command: 'npx vite build && npx vite preview --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
