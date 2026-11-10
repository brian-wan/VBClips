/**
 * Renders the app icons in public/icons/ from the Volleyball mark in src/components/Icons.tsx,
 * using headless Chrome so no image library is needed. Run once after changing the mark:
 *
 *   pnpm icons
 *
 * Set CHROME to the browser binary when it is not at the default macOS location.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = join(import.meta.dirname, '..')
const chrome = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

/** The children of the Volleyball `<svg>`, as plain SVG markup in its 64-unit viewBox. */
function volleyballMarkup(): string {
  const icons = readFileSync(join(root, 'src/components/Icons.tsx'), 'utf8')
  const block = /export const Volleyball[\s\S]*?<svg[^>]*>([\s\S]*?)<\/svg>/.exec(icons)?.[1]
  if (!block) throw new Error('Volleyball mark not found in Icons.tsx')
  const accent = /--color-accent:\s*(#[0-9a-f]{6})/i.exec(
    readFileSync(join(root, 'src/index.css'), 'utf8'),
  )?.[1]
  if (!accent) throw new Error('--color-accent not found in index.css')
  const markup = block
    .replace(
      /\s([a-z]+[A-Z]\w*)=/g,
      (_, name: string) => ` ${name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}=`,
    )
    .replaceAll('var(--color-accent)', accent)
  if (markup.includes('{'))
    throw new Error('Volleyball mark uses a JSX expression; update this script')
  return markup
}

type Icon = { file: string; size: number; background: string; ballShare: number }

const ICONS: Icon[] = [
  { file: 'icon-192.png', size: 192, background: 'transparent', ballShare: 29 / 32 },
  { file: 'icon-512.png', size: 512, background: 'transparent', ballShare: 29 / 32 },
  // A maskable icon is cropped to as little as a centred circle of 80% of its width.
  { file: 'icon-maskable-512.png', size: 512, background: '#000000', ballShare: 0.76 },
]

/** A viewBox around the ball (radius 29 at 32,32) so it spans `ballShare` of the width. */
function viewBox(ballShare: number): string {
  const width = 58 / ballShare
  const origin = 32 - width / 2
  return `${origin} ${origin} ${width} ${width}`
}

const mark = volleyballMarkup()
const work = mkdtempSync(join(tmpdir(), 'vbclipper-icons-'))
try {
  for (const icon of ICONS) {
    const page = join(work, `${icon.file}.html`)
    writeFileSync(
      page,
      `<!doctype html><html><body style="margin:0;background:${icon.background}">` +
        `<svg xmlns="http://www.w3.org/2000/svg" width="${icon.size}" height="${icon.size}" ` +
        `viewBox="${viewBox(icon.ballShare)}" style="display:block">${mark}</svg></body></html>`,
    )
    execFileSync(
      chrome,
      [
        '--headless',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        '--default-background-color=00000000',
        `--window-size=${icon.size},${icon.size}`,
        `--user-data-dir=${join(work, 'profile')}`,
        `--screenshot=${join(root, 'public/icons', icon.file)}`,
        pathToFileURL(page).href,
      ],
      { stdio: 'ignore' },
    )
    console.log(`public/icons/${icon.file}`)
  }
} finally {
  rmSync(work, { recursive: true, force: true })
}
