import { defineConfig, devices } from '@playwright/test';

// Software WebGL so the 3D scene renders in headless Chromium on any machine.
const gl = { launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] } };

export default defineConfig({
  testDir: '.',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4,
  timeout: 60_000,
  reporter: [['html', { open: 'never', outputFolder: '../../playwright-report' }], ['list']],
  outputDir: '../../test-results',
  use: { baseURL: process.env.BASE_URL ?? 'http://localhost:8787', trace: 'retain-on-failure' },
  expect: { timeout: 7_000, toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 }, ...gl } },
    { name: 'laptop', use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, ...gl } },
    { name: 'tablet', use: { ...devices['iPad Pro 11 landscape'] } },
    { name: 'phone', use: { ...devices['Pixel 7 landscape'], ...gl } },
    { name: 'portrait', use: { ...devices['Pixel 7'], ...gl }, testMatch: /layout/ },
  ],
  webServer: {
    command: 'VITE_TEST_HOOKS=1 pnpm --filter web build && pnpm --filter edge run migrate:local && pnpm --filter edge exec wrangler dev --port 8787 --var MOCK_AI:1',
    url: 'http://localhost:8787/api/health',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    cwd: '../..',
  },
});
