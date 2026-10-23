import { useEffect, useState } from "react";
import { CardBrowser } from "./components/CardBrowser";
import { DeckBuilder } from "./components/DeckBuilder";
import { Roster } from "./components/Roster";
import { Play } from "./components/Play";
import { cardStats, decks, stellas } from "./data";

type Tab = "cards" | "deck" | "roster" | "play";

const TABS: { id: Tab; label: string }[] = [
  { id: "cards", label: "카드 뷰어" },
  { id: "deck", label: "덱 빌더" },
  { id: "roster", label: "스트리머" },
  { id: "play", label: "대전" },
];

function tabFromHash(): Tab {
  const h = window.location.hash.replace("#", "");
  return TABS.some((t) => t.id === h) ? (h as Tab) : "cards";
}

export default function App() {
  const [tab, setTab] = useState<Tab>(tabFromHash);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (window.location.hash !== `#${tab}`) {
      window.history.replaceState(null, "", `#${tab}`);
    }
  }, [tab]);

  const select = (next: Tab) => setTab(next);

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <h1>STELARMS</h1>
          <p>팬메이드 2인 대전 카드 게임 · 카드 뷰어 &amp; 덱 빌더 · 온라인 대전</p>
        </div>
        <nav className="app__tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className={tab === t.id ? "active" : ""}
              onClick={() => select(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <dl className="app__stats">
          <div>
            <dt>카드</dt>
            <dd>{cardStats.total}</dd>
          </div>
          <div>
            <dt>스트리머</dt>
            <dd>{stellas.length}</dd>
          </div>
          <div>
            <dt>추천 덱</dt>
            <dd>{decks.length}</dd>
          </div>
        </dl>
      </header>

      <main className="app__main">
        {tab === "cards" && <CardBrowser />}
        {tab === "deck" && <DeckBuilder />}
        {tab === "roster" && <Roster />}
        {tab === "play" && <Play />}
      </main>

      <footer className="app__footer">
        <p>
          카드 이미지는 <code>public/images/&lt;카드ID&gt;.png</code> 경로에
          넣으면 자동으로 표시된다. 카드·덱 데이터는{" "}
          <code>src/data/</code>, 룰 엔진은 <code>src/engine/</code>에서 고친다.
          온라인 대전은 <code>bun run dev:server</code>로 서버를 켠 뒤 이용한다.
        </p>
      </footer>
    </div>
  );
}
