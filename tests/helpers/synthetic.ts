/** Small synthetic posts and threads for tests. Never copies of runs/*.json (those hold Reddit text). */
import type { RawPost } from "../../src/v3/types.ts";

export const NOW_EPOCH = Date.parse("2026-10-01T00:00:00Z") / 1000;
const DAY = 86_400;

export function post(i: number, text: string, extra: Partial<RawPost> = {}): RawPost {
  return {
    id: `t1_c${i}`,
    source: "reddit",
    kind: "comment",
    depth: 0,
    text,
    url: `https://www.reddit.com/r/PortugalExpats/comments/abc123/moving/c${i}/`,
    thread_title: "Canadians in Portugal, any regrets?",
    thread_url: "https://www.reddit.com/r/PortugalExpats/comments/abc123/moving/",
    community: "r/PortugalExpats",
    created_utc: NOW_EPOCH - i * 40 * DAY,
    score: 10 + i,
    author: { handle: `user${i}`, name: null, profile_url: `https://www.reddit.com/user/user${i}`, avatar: null, followers: null },
    ...extra,
  };
}

/** 20 comments: "love" ones answer yes, "regret" ones answer no, the rest take no side. */
export const TEXTS = [
  "I love it here after two years in Lisbon, the pace of life is so much better than Toronto.",
  "Deep regret, the bureaucracy at AIMA took eleven months and we nearly went back to Calgary.",
  "I love the food and the weather, we moved from Ottawa in 2023 and never looked back.",
  "Some regret honestly, salaries are low and rent in Porto keeps climbing every single year.",
  "Does anyone know which documents the consulate in Toronto wants for the D7 visa these days?",
  "We love Portugal, the healthcare was fine and our kids picked up Portuguese within a year.",
  "Big regret about taxes, the NHR ended right before we arrived and nobody warned us about it.",
  "Love the community in the Algarve, plenty of other Canadians and the locals are welcoming.",
  "Just a reminder that the weather in winter is damp and houses have no central heating at all.",
  "I regret selling our house in Vancouver to move here, we cannot afford to go back now.",
  "Love it, but only because we work remotely for Canadian companies and keep Canadian pay.",
  "Mods, can we get a megathread for visa questions please, there are too many of them lately.",
  "Regret it a little, the isolation from family hit much harder than I ever expected it would.",
  "I love the trains and walkable towns, coming from suburban Mississauga it is a different life.",
  "Anyone else watching the housing debate in parliament this week, seems like nothing will change.",
  "Love every minute, two years in and our only complaint is the paperwork at the finance office.",
  "Total regret, my partner could not find work in tech and we are packing up for Halifax now.",
  "We love it and plan to apply for citizenship once we hit the five year mark next spring.",
  "Not sure yet, only arrived three weeks ago and still waiting on our residence card appointment.",
  "I love the cost of groceries compared to Montreal, though electricity bills surprised us badly.",
];

export function syntheticThread() {
  const url = "https://www.reddit.com/r/PortugalExpats/comments/abc123/moving/";
  const opener = post(0, "Canadians in Portugal, any regrets?\nThinking of moving next year, would love to hear from people who did it.", {
    id: "t3_abc123",
    kind: "opener",
    depth: -1,
    url,
  });
  const posts = [opener, ...TEXTS.map((t, i) => post(i + 1, t))];
  return { id: "abc123", title: "Canadians in Portugal, any regrets?", url, community: "r/PortugalExpats", numComments: posts.length - 1, posts };
}
