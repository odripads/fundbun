export function appFiles(distDir: string, prefix?: string): string[]
export function renderServiceWorker(template: string, files: readonly string[], cacheName: string): string
export function buildServiceWorker(distDir: string, templatePath: string): { cacheName: string; fileCount: number }
