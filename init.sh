#!/usr/bin/env bash
set -euo pipefail

WIKI_ROOT="${TOKENSCOPE_WIKI_ROOT:-$HOME/wiki}"
LOCAL_SKILLS_DIR="$WIKI_ROOT/skills"

VIOLA_WIKI_DIR="$WIKI_ROOT/viola-wiki"
PROMPT_WIKI_DIR="$WIKI_ROOT/prompt-wiki"

mkdir -p "$VIOLA_WIKI_DIR" "$PROMPT_WIKI_DIR"
mkdir -p "$LOCAL_SKILLS_DIR/viola-wiki" "$LOCAL_SKILLS_DIR/prompt-wiki"

cat > "$LOCAL_SKILLS_DIR/viola-wiki/SKILL.md" <<'EOF'
---
name: viola-wiki
description: "Use when TokenScope 질문하기 receives @viola-wiki. Read local private Viola knowledge from ~/wiki/viola-wiki and never copy the wiki into a repository."
---

# Viola Wiki

Use this skill only for questions that mention `@viola-wiki`.

## Source

- Wiki root: `~/wiki/viola-wiki`
- This is private internal information.
- Keep the wiki local only. Do not commit, push, vendor, or copy wiki contents into this repository.

## Behavior

1. Search `~/wiki/viola-wiki` for files relevant to the user question.
2. Answer from matched local wiki evidence first.
3. If the wiki has no supporting evidence, say that the local `viola-wiki` did not contain enough evidence.
4. Cite local note paths when useful, but do not dump long internal documents.
EOF

cat > "$LOCAL_SKILLS_DIR/prompt-wiki/SKILL.md" <<'EOF'
---
name: prompt-wiki
description: "Use when TokenScope 질문하기 receives @prompt-wiki. Read local prompt guidance from ~/wiki/prompt-wiki and rewrite the user's question into a clearer, lower-token prompt."
---

# Prompt Wiki

Use this skill only for questions that mention `@prompt-wiki`.

## Source

- Wiki root: `~/wiki/prompt-wiki`
- This may contain private prompt patterns, examples, and internal evaluation notes.
- Keep the wiki local only. Do not commit, push, vendor, or copy wiki contents into this repository.

## Behavior

1. Search `~/wiki/prompt-wiki` for prompt rules and examples relevant to the user question.
2. Preserve the user's intent.
3. Rewrite the question with clearer target, scope, output format, exclusions, and verification criteria.
4. Prefer smaller prompts that reduce exploration, repeated clarification, and unnecessary tool calls.
5. If the wiki has no supporting evidence, say that the local `prompt-wiki` did not contain enough evidence.
EOF

echo "[wiki] initialized local wiki folders:"
echo "       $VIOLA_WIKI_DIR"
echo "       $PROMPT_WIKI_DIR"
echo
echo "[skills] initialized local TokenScope skill files:"
echo "         $LOCAL_SKILLS_DIR/viola-wiki/SKILL.md"
echo "         $LOCAL_SKILLS_DIR/prompt-wiki/SKILL.md"
echo
echo "[wiki] if the shared wiki was downloaded under ~/Downloads/wiki, copy it with:"
echo "       mkdir -p \"$WIKI_ROOT\""
echo "       cp -R ~/Downloads/wiki/viola-wiki ~/Downloads/wiki/prompt-wiki \"$WIKI_ROOT\"/"
