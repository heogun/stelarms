import { useMemo, useState } from "react";
import { CardView } from "./CardView";
import { formatDamage, formatRange } from "./cardUtils";
import type { Card, Deck, Stella } from "../data";
import { cardsByStella, decks, stellas } from "../data";

const NORMAL_LIMIT = 7;
const SPECIAL_LIMIT = 3;

/** 덱 빌더 — 스트리머 2명 선택 → 통상 7 + 비장 3 구성. */
export function DeckBuilder() {
  const [mainId, setMainId] = useState<string>(stellas[0].id);
  const [partnerId, setPartnerId] = useState<string>(stellas[1].id);
  const [normals, setNormals] = useState<string[]>([]);
  const [specials, setSpecials] = useState<string[]>([]);
  const [deckName, setDeckName] = useState("새 덱");

  const main = stellas.find((s) => s.id === mainId)!;
  const partner = stellas.find((s) => s.id === partnerId)!;

  const pool = useMemo(
    () =>
      mainId === partnerId
        ? cardsByStella(mainId)
        : [...cardsByStella(mainId), ...cardsByStella(partnerId)],
    [mainId, partnerId],
  );

  const toggle = (card: Card) => {
    const isNormal = card.kind === "normal";
    const list = isNormal ? normals : specials;
    const setList = isNormal ? setNormals : setSpecials;
    const limit = isNormal ? NORMAL_LIMIT : SPECIAL_LIMIT;

    if (list.includes(card.id)) {
      setList(list.filter((id) => id !== card.id));
    } else if (list.length < limit) {
      setList([...list, card.id]);
    }
  };

  const valid =
    normals.length === NORMAL_LIMIT &&
    specials.length === SPECIAL_LIMIT &&
    mainId !== partnerId;

  const loadDeck = (deck: Deck) => {
    setMainId(deck.mainId);
    setPartnerId(deck.partnerId);
    setNormals(deck.normals);
    setSpecials(deck.specials);
    setDeckName(deck.name);
  };

  const clear = () => {
    setNormals([]);
    setSpecials([]);
    setDeckName("새 덱");
  };

  const selectedId = new Set([...normals, ...specials]);

  return (
    <div className="builder">
      <section className="builder__setup">
        <h2>덱 구성</h2>
        <div className="builder__selects">
          <label>
            <span>메인 스텔라</span>
            <select
              value={mainId}
              onChange={(e) => {
                setMainId(e.target.value);
                clear();
              }}
            >
              {stellas.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>파트너 스텔라</span>
            <select
              value={partnerId}
              onChange={(e) => {
                setPartnerId(e.target.value);
                clear();
              }}
            >
              {stellas.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>덱 이름</span>
            <input
              type="text"
              value={deckName}
              onChange={(e) => setDeckName(e.target.value)}
            />
          </label>
        </div>

        {mainId === partnerId && (
          <p className="warn">메인과 파트너는 서로 다른 스텔라여야 한다.</p>
        )}

        <div className="builder__status">
          <span className={normals.length === NORMAL_LIMIT ? "ok" : "bad"}>
            통상 {normals.length}/{NORMAL_LIMIT}
          </span>
          <span className={specials.length === SPECIAL_LIMIT ? "ok" : "bad"}>
            비장 {specials.length}/{SPECIAL_LIMIT}
          </span>
          <span className={valid ? "ok" : "bad"}>
            {valid ? "유효한 덱" : "미완성"}
          </span>
          <button type="button" onClick={clear}>
            비우기
          </button>
        </div>
      </section>

      <section className="builder__decks">
        <h2>추천 덱 불러오기</h2>
        <div className="deck-list">
          {decks.map((d) => (
            <button
              key={d.id}
              type="button"
              className="deck-chip"
              onClick={() => loadDeck(d)}
            >
              <strong>{d.name}</strong>
              <span>
                {stellas.find((s) => s.id === d.mainId)?.name} +{" "}
                {stellas.find((s) => s.id === d.partnerId)?.name}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="builder__current">
        <h2>{deckName}</h2>
        <StellaSummary stella={main} role="메인" />
        <StellaSummary stella={partner} role="파트너" />
      </section>

      <section className="builder__pool">
        <h2>카드 선택 (클릭해서 추가/제거)</h2>
        <div className="card-grid">
          {pool.map((card) => (
            <div key={card.id} className="builder__slot">
              <CardView
                card={card}
                selected={selectedId.has(card.id)}
                onClick={() => toggle(card)}
              />
            </div>
          ))}
        </div>
      </section>

      <section className="builder__list">
        <h2>덱 내용</h2>
        <h3>통상패 {normals.length}/7</h3>
        <ul>
          {normals.map((id) => {
            const card = pool.find((c) => c.id === id);
            return (
              <li key={id}>
                {card?.name ?? id}{" "}
                {card?.type === "attack" && (
                  <span className="muted">
                    거리 {formatRange(card.range)} · {formatDamage(card)}
                  </span>
                )}
                <button type="button" onClick={() => card && toggle(card)}>
                  ✕
                </button>
              </li>
            );
          })}
          {normals.length === 0 && <li className="muted">없음</li>}
        </ul>

        <h3>비장패 {specials.length}/3</h3>
        <ul>
          {specials.map((id) => {
            const card = pool.find((c) => c.id === id);
            return (
              <li key={id}>
                {card?.name ?? id}{" "}
                {card?.cost !== undefined && (
                  <span className="muted">소모 {card.cost}</span>
                )}
                <button type="button" onClick={() => card && toggle(card)}>
                  ✕
                </button>
              </li>
            );
          })}
          {specials.length === 0 && <li className="muted">없음</li>}
        </ul>
      </section>
    </div>
  );
}

function StellaSummary({ stella, role }: { stella: Stella; role: string }) {
  return (
    <div
      className="stella-summary"
      style={{ ["--card-color" as string]: stella.color }}
    >
      <strong>
        {role}: {stella.name}
      </strong>
      <span>
        신장 {stella.height} · {stella.weapon} ({stella.weaponTier})
      </span>
      <span>적정거리 {stella.mainRange} · 시그니처 {stella.signature}</span>
      <span className="muted">{stella.signatureDesc}</span>
    </div>
  );
}
