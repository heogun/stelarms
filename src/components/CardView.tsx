import { useRef, useState } from "react";
import type { Card } from "../data";
import { cardArtSrc, cardFlatSrc, frameFor, stellaById } from "../data";
import { CardText } from "./CardText";
import { formatDamage, formatRange, typeLabel } from "./cardUtils";
import { useFitText } from "./useFitText";

/**
 * 카드 한 장.
 *
 * 세 겹을 합성한다.
 *   ① 프레임   : `/frames/<종류>.png` (없으면 CSS 내장 프레임)
 *   ② 일러스트 : `/images/art/<카드ID>.png` (없으면 스트리머 색 플레이스홀더)
 *   ③ 텍스트   : 데이터에서 실시간 렌더 (이미지 다시 뽑을 필요 없음)
 *
 * `card.image`가 지정된 카드만 예전처럼 완성 이미지 한 장으로 표시한다.
 */
export function CardView({
  card,
  onClick,
  selected = false,
}: {
  card: Card;
  onClick?: () => void;
  selected?: boolean;
}) {
  const stella = stellaById[card.stellaId];
  const color = stella?.color ?? "#888";
  const flat = cardFlatSrc(card);

  const nameRef = useRef<HTMLHeadingElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  useFitText(nameRef, { factor: 0.088, min: 7.5, cap: 34 });
  useFitText(textRef, { factor: 0.058, min: 6.5, cap: 19 });

  const className = [
    "card",
    `card--${card.kind}`,
    selected ? "card--selected" : "",
    flat ? "card--flat" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <article
      className={className}
      style={{
        ["--card-color" as string]: color,
        ["--card-tint" as string]: `${color}66`,
      }}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={(e) => {
        if (onClick && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {flat ? (
        <img className="card__flat" src={flat} alt={`${card.name} 카드`} />
      ) : (
        <>
          <CardArt card={card} />
          <CardFrame card={card} />
          <div className="card__content">
            <div className="card__top">
              <div className="card__meta">
                <span className={`card__kind card__kind--${card.kind}`}>
                  {card.kind === "normal" ? "통상" : "비장"}
                </span>
                <span className="card__type">{typeLabel(card.type)}</span>
                <span className="card__id">{card.id}</span>
              </div>
              <div className="card__name-wrap">
                <h3 ref={nameRef} className="card__name" title={card.name}>
                  {card.name}
                </h3>
              </div>
            </div>

            <div className="card__bottom">
              <div className="card__stats">
                {card.type === "attack" && (
                  <>
                    <span className="card__stat" title="적정거리">
                      거리 {formatRange(card.range)}
                    </span>
                    <span className="card__stat card__stat--dmg" title="오라/라이프">
                      {formatDamage(card)}
                    </span>
                  </>
                )}
                {card.type === "attach" && card.offering !== undefined && (
                  <span className="card__stat" title="봉납">
                    봉납 {card.offering}
                  </span>
                )}
                {card.kind === "special" && card.cost !== undefined && (
                  <span className="card__stat card__stat--cost" title="소모">
                    소모 {card.cost}
                  </span>
                )}
                {(card.keywords ?? []).map((k) => (
                  <span key={k} className="card__kw">
                    【{k}】
                  </span>
                ))}
              </div>

              <div className="card__text-wrap">
                <p ref={textRef} className="card__text" title={card.text}>
                  <CardText text={card.text} />
                </p>
              </div>
            </div>
          </div>
        </>
      )}
    </article>
  );
}

/**
 * 일러스트 레이어.
 *
 * 플레이스홀더를 항상 깔아 두고 그 위에 이미지를 얹는다.
 * 그래서 이미지가 없거나(404) 아직 로드되지 않아도 빈 칸이 보이지 않는다.
 */
function CardArt({ card }: { card: Card }) {
  const [failed, setFailed] = useState(false);
  const frame = frameFor(card);
  const stella = stellaById[card.stellaId];
  const src = cardArtSrc(card);
  const box = {
    top: `${frame.art.top}%`,
    right: `${frame.art.right}%`,
    bottom: `${frame.art.bottom}%`,
    left: `${frame.art.left}%`,
  };

  return (
    <div className="card__art" style={box}>
      <div className="card__art-fallback">
        <span className="card__art-code">{stella?.code}</span>
        <span className="card__art-hint">일러스트 없음</span>
      </div>
      {src && !failed && (
        <img
          src={src}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

/** 프레임 레이어 (이미지가 없으면 CSS 프레임) */
function CardFrame({ card }: { card: Card }) {
  const [failed, setFailed] = useState(false);
  const frame = frameFor(card);
  if (!frame.image || failed) return null;
  return (
    <img
      className="card__frame"
      src={frame.image}
      alt=""
      aria-hidden="true"
      onError={() => setFailed(true)}
    />
  );
}
