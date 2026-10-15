import {
  sanitizeTitle,
  truncateTitle,
  messageText,
  fallbackTitleFromBranch,
} from "../scripts/herdr-pi-session-title.ts";

let failures = 0;

function check(desc, expected, actual) {
  const expectedJson = JSON.stringify(expected);
  const actualJson = JSON.stringify(actual);
  if (expectedJson === actualJson) {
    console.log(`ok: ${desc}`);
  } else {
    console.log(`FAIL: ${desc} (expected ${expectedJson}, got ${actualJson})`);
    failures += 1;
  }
}

// sanitizeTitle
check("sanitize: plain text passes through", "普通 title 42", sanitizeTitle("普通 title 42"));
check("sanitize: control chars become spaces", "a b c", sanitizeTitle("a\nb\t\x00c"));
check("sanitize: whitespace runs collapse", "x y", sanitizeTitle("  x \n\t y  "));
check("sanitize: empty string", undefined, sanitizeTitle("   "));
check("sanitize: non-string", undefined, sanitizeTitle(123));
check("sanitize: DEL and C1 controls", "d e", sanitizeTitle("d\x7f\x9fe"));

// truncateTitle
check("truncate: under limit untouched", "short", truncateTitle("short", 60));
check("truncate: caps at limit (per code point)", "一二三四五六", truncateTitle("一二三四五六七八", 6));
check("truncate: sanitizes first", "a b", truncateTitle(" a  b ", 60));
check("truncate: empty result", undefined, truncateTitle("  ", 60));

// messageText
check("messageText: string content", "hello", messageText("hello"));
check(
  "messageText: text blocks join",
  "one two",
  messageText([
    { type: "text", text: "one" },
    { type: "text", text: "two" },
  ])
);
check(
  "messageText: image blocks ignored",
  "kept",
  messageText([
    { type: "image", data: "..." },
    { type: "text", text: "kept" },
  ])
);
check("messageText: unknown shape", undefined, messageText(42));

// fallbackTitleFromBranch
const entry = (role, content) => ({
  type: "message",
  message: { role, content },
});

check(
  "branch: latest user message wins",
  "newest prompt",
  fallbackTitleFromBranch([
    entry("system", "preamble"),
    entry("user", "oldest prompt"),
    entry("assistant", [{ type: "text", text: "answer" }]),
    entry("user", "newest prompt"),
    entry("assistant", [{ type: "text", text: "second answer" }]),
  ])
);
check(
  "branch: trailing non-user entries do not hide the latest prompt",
  "newest prompt",
  fallbackTitleFromBranch([
    entry("user", "oldest prompt"),
    entry("user", "newest prompt"),
    { type: "message", message: { role: "toolResult", content: "out" } },
    { type: "compaction", summary: "..." },
  ])
);
check(
  "branch: array content flattened",
  "multi block prompt",
  fallbackTitleFromBranch([entry("user", [{ type: "text", text: "multi block prompt" }])])
);
check(
  "branch: skips assistant and toolResult",
  undefined,
  fallbackTitleFromBranch([
    entry("assistant", "answer"),
    { type: "message", message: { role: "toolResult", content: "out" } },
  ])
);
check(
  "branch: whitespace-only user message skipped",
  "real one",
  fallbackTitleFromBranch([entry("user", "  \n "), entry("user", "real one")])
);
check(
  "branch: trailing whitespace-only message falls back to the one before",
  "real one",
  fallbackTitleFromBranch([entry("user", "real one"), entry("user", "  \n ")])
);
check(
  "branch: trailing image-only message falls back to the one before",
  "real one",
  fallbackTitleFromBranch([
    entry("user", "real one"),
    entry("user", [{ type: "image", data: "..." }]),
  ])
);
check(
  "branch: long latest prompt capped at 60",
  "a".repeat(60),
  fallbackTitleFromBranch([entry("user", "short"), entry("user", "a".repeat(200))])
);
check("branch: no user message", undefined, fallbackTitleFromBranch([entry("system", "x")]));
check("branch: empty branch", undefined, fallbackTitleFromBranch([]));
check("branch: malformed entries skipped", "ok", fallbackTitleFromBranch([null, "junk", entry("user", "ok")]));
check("branch: non-array input", undefined, fallbackTitleFromBranch(undefined));

if (failures > 0) {
  console.log(`${failures} test(s) failed`);
  process.exit(1);
}
console.log("all tests passed");
