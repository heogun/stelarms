// 토너먼트 순수 규칙: 순위·스위스 페어링·삼습일사 검증.

import { describe, expect, test } from "bun:test";
import { decks } from "../src/data/decks";
import {
  pairSwiss,
  resolveTournamentPair,
  semifinalPairs,
  tournamentStandings,
  validateTournamentDeck,
  validateTournamentPicks,
  type StandingInput,
} from "../src/net/tournament";

const D0 = decks.find((deck) => deck.id === "deck-yuni-huya")!;

function player(
  id: string,
  seed: number,
  extra: Partial<StandingInput> = {},
): StandingInput {
  return {
    id,
    name: id.toUpperCase(),
    seed,
    wins: 0,
    losses: 0,
    draws: 0,
    byes: 0,
    opponents: [],
    withdrawn: false,
    ...extra,
  };
}

describe("tournamentStandings", () => {
  test("승 3점·무 1점·부전승 3점과 부흐홀츠를 계산한다", () => {
    const standings = tournamentStandings([
      player("a", 0, { wins: 2, opponents: ["b", "c"] }),
      player("b", 1, { wins: 1, losses: 1, opponents: ["a", "c"] }),
      player("c", 2, { losses: 2, opponents: ["a", "b"] }),
      player("d", 3, { byes: 1 }),
    ]);
    const byId = new Map(standings.map((entry) => [entry.id, entry]));
    expect(byId.get("a")?.points).toBe(6);
    expect(byId.get("a")?.buchholz).toBe(3);
    expect(byId.get("b")?.points).toBe(3);
    expect(byId.get("b")?.buchholz).toBe(6);
    expect(byId.get("d")?.points).toBe(3);
    expect(byId.get("c")?.points).toBe(0);
    expect(standings.map((entry) => entry.id)).toEqual(["a", "b", "d", "c"]);
  });

  test("탈퇴자는 승점과 무관하게 순위표 아래로 보낸다", () => {
    const standings = tournamentStandings([
      player("a", 0, { wins: 1 }),
      player("out", 1, { wins: 5, withdrawn: true }),
    ]);
    expect(standings.map((entry) => entry.id)).toEqual(["a", "out"]);
  });
});

describe("pairSwiss", () => {
  test("가능하면 재대전을 피한다", () => {
    const pairs = pairSwiss([
      player("a", 0, { wins: 1, opponents: ["b"] }),
      player("b", 1, { wins: 1, opponents: ["a"] }),
      player("c", 2, { losses: 1 }),
      player("d", 3, { losses: 1 }),
    ]);
    expect(pairs).toHaveLength(2);
    const flat = pairs.map((pair) => [pair.a, pair.b].sort().join("-"));
    expect(flat).not.toContain("a-b");
  });

  test("홀수 참가자는 한 명에게 부전승을 준다", () => {
    const pairs = pairSwiss([
      player("a", 0),
      player("b", 1),
      player("c", 2),
      player("d", 3),
      player("e", 4),
    ]);
    expect(pairs).toHaveLength(3);
    expect(pairs.filter((pair) => pair.b === null)).toHaveLength(1);
  });

  test("이미 부전승을 받은 참가자에게 다시 부전승을 주지 않는다", () => {
    const pairs = pairSwiss([
      player("a", 0, { wins: 1 }),
      player("b", 1, { wins: 1 }),
      player("bye", 2, { byes: 1 }),
      player("d", 3, { losses: 1 }),
      player("e", 4, { losses: 1 }),
    ]);
    expect(pairs.filter((pair) => pair.b === null).map((pair) => pair.a)).toEqual(["e"]);
  });
});

describe("semifinalPairs", () => {
  test("상위 4명을 1-4, 2-3으로 배치한다", () => {
    const pairs = semifinalPairs([
      player("a", 0, { wins: 3 }),
      player("b", 1, { wins: 2 }),
      player("c", 2, { wins: 1 }),
      player("d", 3, { wins: 0 }),
    ]);
    expect(pairs).toEqual([
      { a: "a", b: "d" },
      { a: "b", b: "c" },
    ]);
  });

  test("4명 미만이면 4강을 만들지 않는다", () => {
    expect(semifinalPairs([player("a", 0), player("b", 1), player("c", 2)])).toBeNull();
  });
});

describe("삼습일사", () => {
  test("서로 다른 스텔라 3명만 허용한다", () => {
    const result = validateTournamentPicks(["yuni", "huya", "hina"]);
    expect(result.ok).toBe(true);
    expect(validateTournamentPicks(["yuni", "yuni", "hina"]).ok).toBe(false);
    expect(validateTournamentPicks(["yuni", "huya"]).ok).toBe(false);
    expect(validateTournamentPicks(["yuni", "huya", "nope"]).ok).toBe(false);
  });

  test("상대 3명 중 하나를 밴해 최종 2명을 남긴다", () => {
    const result = resolveTournamentPair(["yuni", "huya", "hina"], "huya");
    expect(result).toEqual({ ok: true, pair: ["yuni", "hina"] });
    expect(resolveTournamentPair(["yuni", "huya", "hina"], "nope").ok).toBe(false);
  });

  test("남은 2명으로 만든 7+3 덱만 허용한다", () => {
    const result = validateTournamentDeck(
      {
        name: "대회 덱",
        mainId: D0.mainId,
        partnerId: D0.partnerId,
        normals: [...D0.normals],
        specials: [...D0.specials],
      },
      [D0.mainId, D0.partnerId],
    );
    expect(result.ok).toBe(true);

    const wrongPair = validateTournamentDeck(
      {
        name: "대회 덱",
        mainId: D0.mainId,
        partnerId: D0.partnerId,
        normals: [...D0.normals],
        specials: [...D0.specials],
      },
      ["yuni", "hina"],
    );
    expect(wrongPair.ok).toBe(false);
  });
});
