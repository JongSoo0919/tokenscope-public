#!/usr/bin/env bash
set -euo pipefail

WIKI_ROOT="${WIKI_ROOT:-$HOME/wiki}"
CODEX_SKILLS_DIR="${CODEX_SKILLS_DIR:-$HOME/.codex/skills}"
LOCAL_SKILLS_DIR="$WIKI_ROOT/skills"

VIOLA_WIKI_DIR="$WIKI_ROOT/viola-wiki"
PROMPT_WIKI_DIR="$WIKI_ROOT/prompt-wiki"

mkdir -p "$VIOLA_WIKI_DIR" "$PROMPT_WIKI_DIR"
mkdir -p "$LOCAL_SKILLS_DIR/viola-wiki" "$LOCAL_SKILLS_DIR/prompt-wiki" "$CODEX_SKILLS_DIR"

cat > "$LOCAL_SKILLS_DIR/viola-wiki/SKILL.md" <<'EOF'
---
name: viola-wiki
description: "Use when TokenScope or the user asks questions that should be answered from the local private Viola wiki at ~/wiki/viola-wiki. Never copy this wiki into a repository or expose internal content unnecessarily."
---

# Viola Wiki

Use this skill to answer questions from the private local Viola wiki.

## Source

- Wiki root: `~/wiki/viola-wiki`
- This is private company/internal information.
- Keep the wiki local only. Do not copy, vendor, commit, or push wiki contents into any repository.

## Workflow

1. Search `~/wiki/viola-wiki` first with filename and text search.
2. Read only the specific files needed for the question.
3. Prefer direct wiki evidence over memory or assumptions.
4. If the wiki has no matching evidence, say that the local wiki did not contain enough evidence.
5. When answering, cite local note paths when useful, but avoid dumping long internal documents.

## TokenScope / Local LLM Use

When called from TokenScope's question flow, load this `SKILL.md` plus only the relevant files under `~/wiki/viola-wiki`.
Do not require network access.
Do not write back to the wiki unless the user explicitly asks for a wiki edit.
EOF

cat > "$LOCAL_SKILLS_DIR/prompt-wiki/SKILL.md" <<'EOF'
---
name: prompt-wiki
description: "Use when TokenScope or the user asks questions about local prompt patterns, prompt refactoring, token-saving prompt guidance, or prompt examples stored at ~/wiki/prompt-wiki. Keep this private local wiki out of repositories."
---

# Prompt Wiki

Use this skill to answer questions from the private local prompt wiki.

## Source

- Wiki root: `~/wiki/prompt-wiki`
- This may contain private prompt patterns, examples, and internal evaluation notes.
- Keep the wiki local only. Do not copy, vendor, commit, or push wiki contents into any repository.

## Workflow

1. Search `~/wiki/prompt-wiki` first with filename and text search.
2. Read only the specific files needed for the question.
3. Use the wiki as the source of truth for prompt style, scoring criteria, refactoring rules, and examples.
4. If the wiki has no matching evidence, say that the local prompt wiki did not contain enough evidence.
5. When proposing prompt improvements, ground the recommendation in the matched local notes and prefer shorter, lower-token prompts unless the wiki says otherwise.

## TokenScope / Local LLM Use

When called from TokenScope's question flow, load this `SKILL.md` plus only the relevant files under `~/wiki/prompt-wiki`.
Do not require network access.
Do not write back to the wiki unless the user explicitly asks for a wiki edit.
EOF

link_skill() {
  local name="$1"
  local target="$LOCAL_SKILLS_DIR/$name"
  local link="$CODEX_SKILLS_DIR/$name"

  if [ -L "$link" ]; then
    ln -sfn "$target" "$link"
    echo "[skills] updated symlink: $link -> $target"
    return
  fi

  if [ -e "$link" ]; then
    echo "[skills] skip: $link already exists and is not a symlink"
    echo "         remove or rename it manually if you want init.sh to manage this skill."
    return
  fi

  ln -s "$target" "$link"
  echo "[skills] created symlink: $link -> $target"
}

link_skill "viola-wiki"
link_skill "prompt-wiki"

echo
echo "[wiki] local wiki roots:"
echo "       $VIOLA_WIKI_DIR"
echo "       $PROMPT_WIKI_DIR"
echo
echo "[wiki] if you downloaded a shared wiki folder, copy it with:"
echo "       mkdir -p \"$WIKI_ROOT\""
echo "       cp -R ~/Downloads/wiki/viola-wiki ~/Downloads/wiki/prompt-wiki \"$WIKI_ROOT\"/"
