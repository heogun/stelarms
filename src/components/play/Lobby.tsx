// 온라인 대전 로비: 방 만들기/참가, 추천/커스텀 덱 선택, 시작.

import { useState } from "react";
import { decks, stellaById } from "../../data";
import { getCard } from "../../engine";
import type { Online } from "../../net/useOnline";
import type { SeatDeck } from "../../net/protocol";
import {
  customPreview,
  deckChoiceOf,
  presetPreview,
  readDeckSelection,
  readValidCustomDeck,
  writeDeckSelection,
  type DeckSelection,
} from "./deckStorage";

const NAME_KEY = "stelarms.name";

function seatDeckLabel(deck: SeatDeck): string {
  const main = stellaById[deck.mainId]?.name ?? deck.mainId;
  const partner = stellaById[deck.partnerId]?.name ?? deck.partnerId;
  return `${deck.name} · ${main} + ${partner}`;
}

function loadName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

function saveName(value: string): void {
  try {
    localStorage.setItem(NAME_KEY, value);
  } catch {
    // ignore
  }
}

export function Lobby({ online }: { online: Online }) {
  const [name, setName] = useState(loadName);
  const [customDeck] = useState(readValidCustomDeck);
  const [selection, setSelection] = useState<DeckSelection>(readDeckSelection);
  const [joinCode, setJoinCode] = useState("");
  const [copied, setCopied] = useState(false);

  const preset =
    decks.find((deck) => deck.id === (selection.kind === "preset" ? selection.id : "")) ??
    decks[0];
  const choice = deckChoiceOf(selection, customDeck);
  const preview =
    choice.kind === "custom" && customDeck
      ? customPreview(customDeck)
      : presetPreview(preset);
  const selectValue = choice.kind === "custom" ? "custom" : choice.id;

  const changeName = (value: string) => {
    setName(value);
    saveName(value);
  };

  const changeDeck = (value: string) => {
    if (value === "custom") {
      if (!customDeck) return;
      const next: DeckSelection = { kind: "custom" };
      setSelection(next);
      writeDeckSelection(next);
      if (online.room && !online.room.started) {
        online.setDeck({ kind: "custom", deck: customDeck });
      }
      return;
    }
    const next: DeckSelection = { kind: "preset", id: value };
    setSelection(next);
    writeDeckSelection(next);
    if (online.room && !online.room.started) {
      online.setDeck({ kind: "preset", id: value });
    }
  };

  const create = () => {
    if (!online.connected) return;
    online.create(name, choice);
  };

  const join = () => {
    if (!online.connected) return;
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    online.join(code, name, choice);
  };

  const error = online.error && (
    <p className="play__error" role="alert">
      {online.error.message}
      <button type="button" onClick={online.clearError}>
        닫기
      </button>
    </p>
  );

  const deckOptions = (
    <>
      <optgroup label="추천 덱">
        {decks.map((deck) => (
          <option key={deck.id} value={deck.id}>
            {deck.name} · {stellaById[deck.mainId]?.name ?? deck.mainId} +{" "}
            {stellaById[deck.partnerId]?.name ?? deck.partnerId}
          </option>
        ))}
      </optgroup>
      {customDeck && (
        <optgroup label="내 덱">
          <option value="custom">커스텀 · {customDeck.name}</option>
        </optgroup>
      )}
    </>
  );

  const customNote = (
    <p className="lobby__deck-note">
      {customDeck
        ? `커스텀 덱: ${customDeck.name}`
        : "커스텀 덱이 없습니다. 덱 빌더에서 7+3을 완성하세요."}{" "}
      <a href="#deck">덱 빌더 열기</a>
    </p>
  );

  if (!online.room) {
    return (
      <div className="lobby">
        <section className="lobby__hero">
          <h2>온라인 대전</h2>
          <p>
            서버가 모든 판정과 정보 은닉을 담당합니다. 추천 덱 14개 또는 덱
            빌더에서 만든 커스텀 덱으로 방 코드를 공유해 만나세요.
          </p>
          <ul className="lobby__notes">
            <li>카드 효과·덱·시드는 서버가 검증합니다.</li>
            <li>커스텀 덱도 통상 7 + 비장 3, 스텔라 소속·중복을 다시 확인합니다.</li>
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
            <span>내 덱</span>
            <select value={selectValue} onChange={(e) => changeDeck(e.target.value)}>
              {deckOptions}
            </select>
          </label>
          {customNote}

          <DeckPreview deck={preview} />

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
  const other = online.seats[otherSeat];
  const isHost = room.seat === room.hostSeat;
  const bothReady = Boolean(online.seats[0]?.deck && online.seats[1]?.deck);
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
          const deckInfo = info?.deck;
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
                {deckInfo ? seatDeckLabel(deckInfo) : "덱 선택 대기"}
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
            value={selectValue}
            disabled={room.started}
            onChange={(e) => changeDeck(e.target.value)}
          >
            {deckOptions}
          </select>
        </label>
        {customNote}

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

function DeckPreview({ deck, compact = false }: { deck: SeatDeck; compact?: boolean }) {
  const main = stellaById[deck.mainId];
  const partner = stellaById[deck.partnerId];
  const hasCards = Boolean(deck.normals && deck.specials);
  return (
    <details className={`deck-preview ${compact ? "deck-preview--compact" : ""}`}>
      <summary>
        {main?.name ?? deck.mainId} + {partner?.name ?? deck.partnerId}
        {!compact && ` · ${deck.name}`}
      </summary>
      <p className="deck-preview__meta">
        통상 {deck.normalCount} · 비장 {deck.specialCount}
      </p>
      {!compact && hasCards && (
        <ul className="deck-preview__cards">
          {deck.normals?.map((id) => (
            <li key={id}>{getCard(id)?.name ?? id}</li>
          ))}
          {deck.specials?.map((id) => (
            <li key={id} className="special-id">
              {getCard(id)?.name ?? id}
            </li>
          ))}
        </ul>
      )}
      {!compact && !hasCards && (
        <p className="deck-preview__plan">상대 덱의 내용은 비공개입니다.</p>
      )}
    </details>
  );
}
