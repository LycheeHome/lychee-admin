#!/usr/bin/env bash
# UserPromptSubmit hook: route lyly-admin UI/design-decision prompts through the
# comparing-design-variants skill. Advisory context only — never blocks a prompt.
#
# Precision matters more than recall here: a hook that fires on half of all
# prompts gets ignored, which costs more than the misses it catches. So the
# groups below are split by how much they can carry on their own.
#
# The left \b is load-bearing throughout: unanchored "ui" matches "build" and
# "quick", unanchored "card" matches "discard". Stems take \w* so "visually",
# "styles" and "redesigning" match their root.
set -uo pipefail

prompt="$(jq -r '.prompt // ""' 2>/dev/null)" || exit 0
[ -n "$prompt" ] || exit 0

# STRONG — explicit design vocabulary. Fires alone.
STRONG='\b(design\w*|restyl\w*|styl\w*|layout|mockup\w*|wireframe\w*|variant\w*|mobbin|reference\w*|precedent\w*|prior art|typograph\w*|palette|spacing|visual\w*|ui|ux|card|cards|grid|pill|pills|badge|dropdown|breadcrumb)\b'

# COMPLAINT — only ever said about how something looks. Fires alone.
COMPLAINT='\b(cramped|cluttered|lopsided|unbalanced|too busy|too noisy|hard to scan|easier to scan|easier to read|hard to read)\b'

# NOUN — a surface in this app, but also an ordinary code word: "the
# Authorization header", "the form validation rejects valid ports", "does the
# modal close on escape". Never fires alone; needs INTENT alongside it.
NOUN='\b(empty state|modal|toast|header|footer|form|surface|section|page)\b'

# INTENT — asking what something should look or feel like, or for alternatives.
# Deliberately excludes a bare "should": "the toast should say removed, not
# removing" is a copy fix, not a variants job.
INTENT='\b(look|looks|looking) like\b|\bfeels? (more )?like\b|\b(options|alternatives|rethink|redesign\w*|improve|cleaner|tighter|denser|clearer)\b'

fire=no
printf '%s' "$prompt" | grep -Eiq "$STRONG|$COMPLAINT" && fire=yes
if [ "$fire" = no ]; then
  printf '%s' "$prompt" | grep -Eiq "$NOUN" \
    && printf '%s' "$prompt" | grep -Eiq "$INTENT" \
    && fire=yes
fi

if [ "$fire" = yes ]; then
  cat <<'JSON'
{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"This prompt looks like a lyly-admin UI/design decision. Invoke the `comparing-design-variants` skill before answering and follow its deliverable contract: Mobbin reference row, four named variants, one labelled control screenshotted live, a cost line per variant, implicit decisions named. If this is a literal typo, a pure copy fix, or a behavior/logic question with no visual decision in it, say so in one line and skip the skill."}}
JSON
fi
exit 0
