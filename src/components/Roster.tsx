import { useState } from "react";
import { CardView } from "./CardView";
import { cardCountByStella, cardsByStella, generations, stellas } from "../data";

/** 로스터 — 기수별 스트리머 정보와 그 스트리머의 카드 전체. */
export function Roster() {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="roster">
      {generations.map((gen) => (
        <section key={gen.id} className="roster__gen">
          <h2 style={{ ["--gen-color" as string]: gen.color }}>
            {gen.label}
          </h2>
          <p className="roster__concept">{gen.concept}</p>
          <div className="roster__grid">
            {stellas
              .filter((s) => s.generation === gen.id)
              .map((s) => {
                const open = openId === s.id;
                return (
                  <article
                    key={s.id}
                    className="stella-card"
                    style={{ ["--card-color" as string]: s.color }}
                  >
                    <header>
                      <h3>{s.name}</h3>
                      <span className="stella-card__gen">{s.nameEn}</span>
                    </header>
                    <p className="stella-card__tagline">{s.tagline}</p>
                    <dl>
                      <dt>신장</dt>
                      <dd>{s.height}</dd>
                      <dt>무기</dt>
                      <dd>
                        {s.weapon} ({s.weaponTier})
                      </dd>
                      <dt>적정거리</dt>
                      <dd>{s.mainRange}</dd>
                      <dt>시그니처</dt>
                      <dd>
                        {s.signature} — {s.signatureDesc}
                      </dd>
                      <dt>플레이</dt>
                      <dd>{s.playstyle}</dd>
                      <dt>난이도</dt>
                      <dd>{"★".repeat(s.difficulty)}</dd>
                      <dt>궁합</dt>
                      <dd>
                        {s.pairsWith
                          .map((id) => stellas.find((x) => x.id === id)?.name)
                          .join(", ")}
                      </dd>
                    </dl>
                    {s.nameSources && (
                      <p className="stella-card__sources">
                        이름 출처: {s.nameSources}
                      </p>
                    )}
                    <button
                      type="button"
                      className="stella-card__toggle"
                      onClick={() => setOpenId(open ? null : s.id)}
                    >
                      카드 {cardCountByStella(s)}장 {open ? "접기" : "보기"}
                    </button>
                    {open && (
                      <div className="card-grid card-grid--nested">
                        {cardsByStella(s.id).map((c) => (
                          <CardView key={c.id} card={c} />
                        ))}
                      </div>
                    )}
                  </article>
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
