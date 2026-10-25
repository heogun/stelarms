// Bun 전역의 최소 타입 선언.
//
// `@types/bun`을 추가하지 않고도 서버 코드를 `tsc`로 검사하기 위한 것.
// 실제로 사용하는 API만 선언한다.

interface BunFile extends Blob {
  exists(): Promise<boolean>;
}

interface BunWebSocket<T> {
  data: T;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  remoteAddress?: string;
}

interface BunUpgradeServer<T> {
  upgrade(req: Request, options: { data: T }): boolean;
}

interface BunServeOptions<T> {
  port?: number;
  hostname?: string;
  development?: boolean;
  fetch(
    req: Request,
    server: BunUpgradeServer<T>,
  ): Response | undefined | Promise<Response | undefined>;
  websocket: {
    open?(ws: BunWebSocket<T>): void;
    message(ws: BunWebSocket<T>, message: string | Uint8Array): void | Promise<void>;
    close?(ws: BunWebSocket<T>, code: number, reason: string): void;
  };
}

interface BunServer {
  port: number;
  hostname: string;
  stop(): void;
  requestIP?(req: Request): { address: string; family?: string; port?: number } | null;
}

declare const Bun: {
  serve<T>(options: BunServeOptions<T>): BunServer;
  file(path: string): BunFile;
  env: Record<string, string | undefined>;
};

declare const process: {
  env: Record<string, string | undefined>;
  argv: string[];
  cwd(): string;
  exit(code?: number): never;
  on(event: string, listener: (...args: any[]) => void): void;
};
