// `#play` 탭: 로비 ↔ 대전 보드.

import { useOnline } from "../net/useOnline";
import { Game } from "./play/Game";
import { Lobby } from "./play/Lobby";

export function Play() {
  const online = useOnline();

  if (online.resuming && !online.room) {
    return (
      <div className="play-loading">
        <p>이전 대전으로 재접속하는 중…</p>
        <p className="muted">잠시만 기다려 주세요.</p>
      </div>
    );
  }

  if (!online.room || !online.room.started) {
    return <Lobby online={online} />;
  }

  if (!online.view) {
    return (
      <div className="play-loading">
        <p>대전 상태를 받는 중…</p>
        <p className="muted">방 코드 {online.room.roomCode}</p>
        {online.error && (
          <p className="play__error" role="alert">
            {online.error.message}
          </p>
        )}
      </div>
    );
  }

  return <Game online={online} view={online.view} />;
}
