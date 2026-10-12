import { getRedditComments, searchReddit } from "../src/sources/reddit/index.ts";

const query = process.argv.slice(2).join(" ") || "iphone vs samsung";

let t = Date.now();
const results = await searchReddit(query);
console.log(`search: ${results.length} posts in ${Date.now() - t}ms`);
for (const r of results.slice(0, 5)) console.log(`  ${r.subreddit}  ${r.title}`);

t = Date.now();
const comments = await getRedditComments(results);
console.log(`comments: ${comments.length} in ${Date.now() - t}ms`);
console.log(comments.slice(0, 3).map((c) => ({ score: c.score, sub: c.subreddit, text: c.content.slice(0, 80) })));
