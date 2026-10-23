import { useEffect, useMemo, useState } from "react";
import { CardView } from "./CardView";
import { typeLabel, formatDamage, formatRange } from "./cardUtils";
import type { Card, CardType, GenerationId } from "../data";
import {
  allCards,
  generations,
  searchCards,
  stellas,
  stellaById,
} from "../data";

const ALL = "all";

/** 카드 그리드 크기 */
type CardSize = "sm" | "md" | "lg";

/** 카드 뷰어 — 기수/스트리머/타입/키워드 필터 + 검색. */
export function CardBrowser() {
  const [generation, setGeneration] = useState<GenerationId | typeof ALL>(ALL);
  const [stellaId, setStellaId] = useState<string | typeof ALL>(ALL);
  const [type, setType] = useState<CardType | typeof ALL>(ALL);
  const [keyword, setKeyword] = useState<string | typeof ALL>(ALL);
  const [query, setQuery] = useState("");
  const [size, setSize] = useState<CardSize>("md");
  const [detail, setDetail] = useState<Card | null>(null);

  // Esc 로 상세 닫기
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [detail]);

  const keywordPool = useMemo(() => {
    const set = new Set<string>();
    for (const c of allCards) for (const k of c.keywords ?? []) set.add(k);
    return [...set].sort();
  }, []);

  const visibleStellas = useMemo(
    () =>
      generation === ALL
        ? stellas
        : stellas.filter((s) => s.generation === generation),
    [generation],
  );

  const filtered = useMemo(() => {
    let pool: Card[] = query.trim() ? searchCards(query) : allCards;

    if (generation !== ALL) {
      pool = pool.filter(
        (c) => stellaById[c.stellaId]?.generation === generation,
      );
    }
    if (stellaId !== ALL) pool = pool.filter((c) => c.stellaId === stellaId);
    if (type !== ALL) pool = pool.filter((c) => c.type === type);
    if (keyword !== ALL)
      pool = pool.filter((c) => c.keywords?.includes(keyword));

    return pool;
  }, [generation, stellaId, type, keyword, query]);

  return (
    <div className="browser">
      <div className="filters">
        <label className="filters__search">
          <span>검색</span>
          <input
            type="search"
            placeholder="카드 이름 · 텍스트 · 출처"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>

        <label>
          <span>기수</span>
          <select
            value={generation}
            onChange={(e) => {
              const v = e.target.value as GenerationId | typeof ALL;
              setGeneration(v);
              setStellaId(ALL);
            }}
          >
            <option value={ALL}>전체</option>
            {generations.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>스트리머</span>
          <select
            value={stellaId}
            onChange={(e) => setStellaId(e.target.value)}
          >
            <option value={ALL}>전체</option>
            {visibleStellas.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>타입</span>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as CardType | typeof ALL)}
          >
            <option value={ALL}>전체</option>
            <option value="attack">공격</option>
            <option value="action">행동</option>
            <option value="attach">부여</option>
          </select>
        </label>

        <label>
          <span>키워드</span>
          <select value={keyword} onChange={(e) => setKeyword(e.target.value)}>
            <option value={ALL}>전체</option>
            {keywordPool.map((k) => (
              <option key={k} value={k}>
                【{k}】
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          className="filters__reset"
          onClick={() => {
            setGeneration(ALL);
            setStellaId(ALL);
            setType(ALL);
            setKeyword(ALL);
            setQuery("");
          }}
        >
          초기화
        </button>
      </div>

      <div className="browser__bar">
        <p className="browser__count">
          {filtered.length}장
          {type !== ALL ? ` · ${typeLabel(type)}` : ""}
        </p>
        <div className="size-toggle" role="group" aria-label="카드 크기">
          <span>크기</span>
          {(
            [
              ["sm", "작게"],
              ["md", "보통"],
              ["lg", "크게"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={size === value ? "active" : ""}
              onClick={() => setSize(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className={`card-grid${size === "md" ? "" : ` card-grid--${size}`}`}>
        {filtered.map((card) => (
          <CardView key={card.id} card={card} onClick={() => setDetail(card)} />
        ))}
        {filtered.length === 0 && (
          <p className="empty">조건에 맞는 카드가 없다.</p>
        )}
      </div>

      {detail && (
        <div className="modal" onClick={() => setDetail(null)}>
          <div
            className="modal__panel"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label={`${detail.name} 카드 상세`}
          >
            <button
              type="button"
              className="modal__close"
              onClick={() => setDetail(null)}
            >
              닫기 ✕
            </button>
            <CardView card={detail} />
            <CardDetail card={detail} />
            <p className="modal__hint">
              텍스트는 데이터에서 실시간으로 그려진다 · Esc 로 닫기
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

/** 모달 아래에 붙는 카드 메타 정보 */
function CardDetail({ card }: { card: Card }) {
  const stella = stellaById[card.stellaId];
  return (
    <div className="card-detail">
      <dl>
        <dt>카드</dt>
        <dd>
          {card.name} <span className="muted">({card.id})</span>
        </dd>
        <dt>분류</dt>
        <dd>
          {card.kind === "normal" ? "통상패" : "비장패"} ·{" "}
          {typeLabel(card.type)}
        </dd>
        {card.type === "attack" && (
          <>
            <dt>공격</dt>
            <dd>
              거리 {formatRange(card.range)} · {formatDamage(card)}
            </dd>
          </>
        )}
        {card.offering !== undefined && (
          <>
            <dt>봉납</dt>
            <dd>{card.offering}</dd>
          </>
        )}
        {card.cost !== undefined && (
          <>
            <dt>소모</dt>
            <dd>{card.cost}</dd>
          </>
        )}
        {card.source && (
          <>
            <dt>출처</dt>
            <dd>{card.source}</dd>
          </>
        )}
      </dl>
      {card.notes && <p className="card-detail__notes">{card.notes}</p>}
      {stella && (
        <p className="card-detail__notes">
          {stella.name} · 신장 {stella.height} · {stella.weapon} · 적정거리{" "}
          {stella.mainRange}
        </p>
      )}
    </div>
  );
}
