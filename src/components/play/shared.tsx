// 대전 보드에서 공용으로 쓰는 조각들.

import { CardView } from "../CardView";
import { stellaById } from "../../data";
import type { AttackDraft, CounterId, YouView, FoeView } from "../../engine";
import { getCard } from "../../engine";
import { COUNTER_LABELS, cardName } from "./viewUtils";

export function ResourcePills({ p }: { p: YouView | FoeView }) {
  return (
    <div className="pp__res">
      <span className="pill pill--life" title="라이프">
        라이프 <b>{p.life}</b>
      </span>
      <span className="pill pill--aura" title="오라">
        오라 <b>{p.aura}</b>
      </span>
      <span className="pill pill--flare" title="플레어">
        플레어 <b>{p.flare}</b>
      </span>
      <span className="pill pill--dust" title="더스트">
        더스트 <b>{p.dust}</b>
      </span>
      <span className="pill pill--focus" title="집중력">
        집중 <b>{p.focus}</b>
      </span>
    </div>
  );
}

export function PlayerPanel({
  p,
  side,
  active,
  connected,
}: {
  p: YouView | FoeView;
  side: "you" | "foe";
  active: boolean;
  connected: boolean;
}) {
  const stellas = p.stellas.map((id) => stellaById[id]?.name ?? id).join(" · ");
  const counters = (Object.keys(COUNTER_LABELS) as CounterId[])
    .map((key) => ({ key, n: p.counters[key] ?? 0 }))
    .filter((x) => x.n > 0);
  const isYou = side === "you";
  const cover = isYou && "cover" in p ? p.cover : [];

  return (
    <section className={`pp pp--${side} ${active ? "pp--active" : ""}`}>
      <header className="pp__head">
        <div>
          <h3>
            {p.name} {!connected && <span className="pp__offline">연결 끊김</span>}
          </h3>
          <p className="pp__sub">{stellas}</p>
        </div>
        <div className="pp__badges">
          {active && <span className="badge badge--turn">턴</span>}
          <span className={`badge badge--stance badge--${p.stance}`}>
            {p.stance === "day" ? "낮" : "밤"}
          </span>
          {p.flags.mode && (
            <span className="badge badge--mode">
              {p.flags.mode === "power" ? "전력" : "표준"}
            </span>
          )}
          <span className="badge">
            기본 {p.flags.basicsUsed}/{p.flags.basicLimit}
          </span>
          <span className="badge">공격 {p.flags.attacks}</span>
        </div>
      </header>

      <ResourcePills p={p} />

      <div className="pp__piles">
        <span title="손패">손패 {p.handCount}</span>
        <span title="패산">패산 {p.deckCount}</span>
        <span title="덮음패">덮음 {p.coverCount}</span>
        <span title="버림패">버림 {p.discardCount}</span>
      </div>

      {(counters.length > 0 || p.buffs.length > 0 || p.restrictions.length > 0) && (
        <div className="pp__chips">
          {counters.map(({ key, n }) => (
            <span key={key} className={`chip chip--${key}`}>
              {COUNTER_LABELS[key]} {n}
            </span>
          ))}
          {p.buffs.map((b) => (
            <span key={b.id} className="chip chip--buff">
              {b.label}
              {b.aura > 0 ? ` +${b.aura}오라` : ""}
              {b.life > 0 ? ` +${b.life}라이프` : ""}
              {b.rangeExpand ? ` 거리+${b.rangeExpand}` : ""}
            </span>
          ))}
          {p.restrictions.map((r, i) => (
            <span key={`${r.kind}-${i}`} className="chip chip--restrict">
              {r.label}
            </span>
          ))}
        </div>
      )}

      {p.attaches.length > 0 && (
        <div className="pp__attaches">
          <span className="pp__label">부여</span>
          {p.attaches.map((a) => (
            <span key={a.uid} className="attach" title={cardName(a.cardId)}>
              {cardName(a.cardId)}
              <b>{"◆".repeat(a.crystals)}</b>
            </span>
          ))}
        </div>
      )}

      {p.specials.length > 0 && (
        <div className="pp__specials">
          <span className="pp__label">비장</span>
          {p.specials.map((s) => {
            const id = "cardId" in s ? s.cardId : undefined;
            return (
              <span
                key={s.uid}
                className={`special ${s.used ? "special--used" : ""} ${
                  s.faceUp ? "" : "special--hidden"
                }`}
              >
                {s.faceUp && id ? cardName(id) : "비장패"}
                {s.used ? " · 사용" : ""}
              </span>
            );
          })}
        </div>
      )}

      {isYou && cover.length > 0 && (
        <details className="pp__details">
          <summary>덮음패 {cover.length}장</summary>
          <ul>
            {cover.map((c) => (
              <li key={c.uid}>{cardName(c.cardId)}</li>
            ))}
          </ul>
        </details>
      )}

      {p.discard.length > 0 && (
        <details className="pp__details">
          <summary>버림패 {p.discard.length}장</summary>
          <ul>
            {p.discard.map((c) => (
              <li key={c.uid}>{cardName(c.cardId)}</li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

export function AttackSummary({
  attack,
  attackerName,
}: {
  attack: AttackDraft;
  attackerName: string;
}) {
  const card = getCard(attack.cardId);
  const keywords = card?.keywords ?? [];
  return (
    <div className="attack">
      <div className="attack__head">
        <span className="attack__owner">{attackerName}의 공격</span>
        <strong>{card?.name ?? attack.cardId}</strong>
        <span className="attack__range">
          거리 {Array.isArray(attack.range) ? `${attack.range[0]}–${attack.range[1]}` : attack.range}
        </span>
      </div>
      <div className="attack__damage">
        <span className="damage damage--aura">오라 {attack.aura}</span>
        <span className="damage damage--life">라이프 {attack.life}</span>
        {attack.pierce && <span className="keyword keyword--pierce">【필중】</span>}
        {attack.super && <span className="keyword keyword--super">【초극】</span>}
        {keywords.includes("전력") && <span className="keyword">【전력】</span>}
      </div>
      {attack.reductions.length > 0 && (
        <p className="attack__note">
          대응으로 감소:{" "}
          {attack.reductions.map((r) => `오라 -${r.aura}/라이프 -${r.life}`).join(", ")}
        </p>
      )}
    </div>
  );
}

/** 카드 ID로 CardView를 그린다. (없으면 텍스트) */
export function SmallCard({
  cardId,
  selected,
  used,
  onClick,
  width = 128,
}: {
  cardId: string;
  selected?: boolean;
  used?: boolean;
  onClick?: () => void;
  width?: number;
}) {
  const card = getCard(cardId);
  if (!card) return <span className="missing-card">{cardId}</span>;
  return (
    <div
      className={`small-card ${selected ? "small-card--selected" : ""} ${
        used ? "small-card--used" : ""
      }`}
      style={{ width }}
    >
      <CardView card={card} selected={selected} onClick={onClick} />
      {used && <span className="small-card__used">사용 완료</span>}
    </div>
  );
}
