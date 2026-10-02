# Outcome-only game dialogue

## What will change
- Sync the project workspace with the latest `main` state for `declare-love` without creating another repository.
- Hide in-round narration from the game table while retaining actionable controls and error feedback.
- Show dialogue only when a round ends, limited to the final player scores and winner outcome.
- Preserve the face-up reveal after an incorrect discard and keep the Learning Manual unchanged.
- Build the project with the existing post-build patch steps, then verify the generated output and game screen without publishing.

## Technical details
- Gate the visible game log by round phase rather than removing engine state needed by gameplay.
- Keep card visibility rules and discard resolution untouched so incorrect discards still reveal the attempted card.
- Validate with targeted gameplay checks, the project build, and current build diagnostics.
