// 온라인 대전 로비: 방 만들기/참가, 덱 선택, 시작.

import { useMemo, useState } from "react";
import { decks, stellaById } from "../../data";
import type { Deck } from "../../data";
import { getCard } from "../../engine";
import type { Online } from "../../net/useOnline";

const NAME_KEY = "stelarms.name";
const DECK_KEY = "stelarms.deck";

function deckLabel(deck: Deck): string {
  const main = stellaById[deck.mainId]?.name ?? deck.mainId;
  const partner = stellaById[deck.partnerId]?.name ?? deck.partnerId;
  return `${deck.name} · ${main} + ${partner}`;
}

function load(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function save(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export function Lobby({ online }: { online: Online }) {
  const [name, setName] = useState(() => load(NAME_KEY, ""));
  const [deckId, setDeckId] = useState(() => load(DECK_KEY, decks[0].id));
  const [joinCode, setJoinCode] = useState("");
  const [copied, setCopied] = useState(false);

  const deck = useMemo(
    () => decks.find((d) => d.id === deckId) ?? decks[0],
    [deckId],
  );

  const changeName = (value: string) => {
    setName(value);
    save(NAME_KEY, value);
  };
  const changeDeck = (value: string) => {
    setDeckId(value);
    save(DECK_KEY, value);
    if (online.room && !online.room.started) online.setDeck(value);
  };

  const create = () => {
    if (!online.connected) return;
    online.create(name, deckId);
  };

  const join = () => {
    if (!online.connected) return;
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    online.join(code, name, deckId);
  };

  const error = online.error && (
    <p className="play__error" role="alert">
      {online.error.message}
      <button type="button" onClick={online.clearError}>
        닫기
      </button>
    </p>
  );

  if (!online.room) {
    return (
      <div className="lobby">
        <section className="lobby__hero">
          <h2>온라인 대전</h2>
          <p>
            서버가 모든 판정과 정보 은닉을 담당합니다. 두 사람이 각각 추천 덱을
            고르고, 방 코드로 만나세요.
          </p>
          <ul className="lobby__notes">
            <li>카드 효과·덱·시드는 서버가 검증합니다.</li>
            <li>상대 손패·패산·덮음패는 클라이언트로 전송되지 않습니다.</li>
            <li>연결이 끊겨도 같은 브라우저 탭에서 자동으로 재접속합니다.</li>
          </ul>
        </section>

        <section className="lobby__panel">
          <div className="lobby__status">
            <span className={`dot ${online.connected ? "dot--on" : "dot--off"}`} />
            {online.connected ? "서버 연결됨" : "서버 연결 중…"}
          </div>

          <label className="field">
            <span>표시 이름</span>
            <input
              value={name}
              maxLength={24}
              placeholder="이름"
              onChange={(e) => changeName(e.target.value)}
            />
          </label>

          <label className="field">
            <span>추천 덱</span>
            <select value={deckId} onChange={(e) => changeDeck(e.target.value)}>
              {decks.map((d) => (
                <option key={d.id} value={d.id}>
                  {deckLabel(d)}
                </option>
              ))}
            </select>
          </label>

          <DeckPreview deck={deck} />

          {error}

          <div className="lobby__actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={!online.connected}
              onClick={create}
            >
              방 만들기
            </button>
          </div>

          <div className="lobby__join">
            <label className="field">
              <span>방 코드</span>
              <input
                value={joinCode}
                maxLength={6}
                placeholder="6자리"
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") join();
                }}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={!online.connected || joinCode.trim().length !== 6}
              onClick={join}
            >
              참가
            </button>
          </div>
        </section>
      </div>
    );
  }

  const room = online.room;
  const mySeat = room.seat;
  const otherSeat = mySeat === 0 ? 1 : 0;
  const mine = online.seats[mySeat];
  const other = online.seats[otherSeat];
  const isHost = room.seat === room.hostSeat;
  const bothReady = Boolean(online.seats[0]?.deckId && online.seats[1]?.deckId);
  const canStart = isHost && Boolean(online.seats[0]) && Boolean(online.seats[1]) && bothReady;

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(room.roomCode);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // 클립보드 권한이 없으면 코드를 직접 보여준다.
    }
  };

  return (
    <div className="room">
      <header className="room__head">
        <div>
          <p className="room__eyebrow">방 코드</p>
          <div className="room__code">
            <strong>{room.roomCode}</strong>
            <button type="button" className="btn btn--tiny" onClick={copyCode}>
              {copied ? "복사됨" : "복사"}
            </button>
          </div>
        </div>
        <div className="room__status">
          <span className={`dot ${online.connected ? "dot--on" : "dot--off"}`} />
          {online.connected ? "연결됨" : "재접속 중…"}
        </div>
      </header>

      <div className="room__seats">
        {[0, 1].map((seat) => {
          const info = online.seats[seat];
          const isMine = seat === mySeat;
          const deckInfo = info?.deckId ? decks.find((d) => d.id === info.deckId) : null;
          return (
            <div
              key={seat}
              className={`seat ${isMine ? "seat--mine" : ""} ${info ? "" : "seat--empty"}`}
            >
              <div className="seat__top">
                <span className="seat__name">
                  {info?.name ?? "대기 중"}
                  {seat === room.hostSeat && <span className="badge">방장</span>}
                  {isMine && <span className="badge badge--me">나</span>}
                </span>
                <span className={`dot ${info?.connected ? "dot--on" : "dot--off"}`} />
              </div>
              <p className="seat__deck">
                {deckInfo ? deckLabel(deckInfo) : info?.deckId ? info.deckId : "덱 선택 대기"}
              </p>
              {deckInfo && <DeckPreview deck={deckInfo} compact />}
            </div>
          );
        })}
      </div>

      <section className="room__controls">
        <label className="field">
          <span>내 덱</span>
          <select
            value={mine?.deckId ?? deckId}
            disabled={room.started}
            onChange={(e) => {
              setDeckId(e.target.value);
              save(DECK_KEY, e.target.value);
              online.setDeck(e.target.value);
            }}
          >
            {decks.map((d) => (
              <option key={d.id} value={d.id}>
                {deckLabel(d)}
              </option>
            ))}
          </select>
        </label>

        {error}

        <div className="room__buttons">
          {isHost ? (
            <button
              type="button"
              className="btn btn--primary"
              disabled={!canStart || !online.connected}
              onClick={online.start}
            >
              {!other
                ? "상대 입장 대기 중"
                : !bothReady
                  ? "덱 선택 대기 중"
                  : "대전 시작"}
            </button>
          ) : (
            <p className="room__wait">방장이 시작하기를 기다리는 중…</p>
          )}
          <button type="button" className="btn" onClick={online.leave}>
            나가기
          </button>
        </div>
        <p className="room__hint">
          이 탭을 닫아도 같은 브라우저에서 다시 열면 자동으로 재접속합니다.
        </p>
      </section>
    </div>
  );
}

function DeckPreview({ deck, compact = false }: { deck: Deck; compact?: boolean }) {
  const main = stellaById[deck.mainId];
  const partner = stellaById[deck.partnerId];
  return (
    <details className={`deck-preview ${compact ? "deck-preview--compact" : ""}`}>
      <summary>
        {main?.name ?? deck.mainId} + {partner?.name ?? deck.partnerId}
        {!compact && ` · ${deck.name}`}
      </summary>
      <p className="deck-preview__plan">{deck.plan[0]}</p>
      <p className="deck-preview__meta">
        통상 {deck.normals.length} · 비장 {deck.specials.length}
      </p>
      {!compact && (
        <ul className="deck-preview__cards">
          {deck.normals.map((id) => (
            <li key={id}>{getCard(id)?.name ?? id}</li>
          ))}
          {deck.specials.map((id) => (
            <li key={id} className="special-id">
              {getCard(id)?.name ?? id}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}
