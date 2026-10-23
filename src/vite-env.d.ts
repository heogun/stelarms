/// <reference types="vite/client" />

/**
 * `vite.config.ts`의 assetManifest 플러그인이 만들어 주는 가상 모듈.
 * `public/images/art`, `public/frames`에 실제로 있는 파일만 담긴다.
 */
declare module 'virtual:asset-manifest' {
  /** 파일명(확장자 제외) -> 실제 파일명 */
  export const artFiles: Record<string, string>
  /** 파일명(확장자 제외) -> 실제 파일명 */
  export const frameFiles: Record<string, string>
}

interface ImportMetaEnv {
  readonly DEV: boolean
  readonly PROD: boolean
  readonly VITE_WS_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
