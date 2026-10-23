import react from '@vitejs/plugin-react'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const ASSET_RE = /\.(png|jpe?g|webp|avif)$/i
const ASSET_DIRS = ['public/images/art', 'public/frames']

/**
 * `public/` 아래 아트·프레임 파일 목록을 가상 모듈로 노출한다.
 *
 * 파일이 없는 카드에까지 `<img>`를 걸면 404 요청이 카드 수만큼 쌓인다.
 * 존재하는 파일만 경로를 만들어 주면, 파일을 넣는 순간 자동으로 표시되면서도
 * 빈 카드에서는 조용히 플레이스홀더가 보인다.
 */
function assetManifest(): Plugin {
  const id = 'virtual:asset-manifest'
  const resolved = `\0${id}`

  const scan = (dir: string) => {
    const abs = join(process.cwd(), dir)
    if (!existsSync(abs)) return {}
    const files: Record<string, string> = {}
    for (const file of readdirSync(abs)) {
      if (!ASSET_RE.test(file)) continue
      files[file.replace(ASSET_RE, '')] = file
    }
    return files
  }

  return {
    name: 'stelarms-asset-manifest',
    resolveId: (source) => (source === id ? resolved : null),
    load: (target) =>
      target === resolved
        ? [
            `export const artFiles = ${JSON.stringify(scan(ASSET_DIRS[0]))}`,
            `export const frameFiles = ${JSON.stringify(scan(ASSET_DIRS[1]))}`,
          ].join('\n')
        : null,
    configureServer(server) {
      for (const dir of ASSET_DIRS) {
        const abs = join(process.cwd(), dir)
        if (existsSync(abs)) server.watcher.add(abs)
      }
      server.watcher.on('all', (_event, file) => {
        if (!/[\\/]public[\\/](images[\\/]art|frames)[\\/]/.test(file)) return
        const mod = server.moduleGraph.getModuleById(resolved)
        if (mod) server.moduleGraph.invalidateModule(mod)
        server.ws.send({ type: 'full-reload' })
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), assetManifest()],
})
