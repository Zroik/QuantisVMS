# VMS Project — Always-On Engineering Rules
(Place at `.agents/rules/vms-guardrails.md` and set activation to **Always On**.)

## Source of truth
1. The user's latest message. 2. `docs/VMS_BUILD_SPEC.md`. 3. `docs/source/*.docx`. 4. Your own memory (lowest priority).
If the spec conflicts with reality (package missing, flag removed), take the smallest safe deviation, log it in `docs/DECISIONS.md` (ID, context, choice, evidence), and tell the user. Do not silently improvise.

## Proof, not claims
- Never write "done / works / passes / fixed" unless you executed the check in this session and saw the output.
- Paste the command and its key output lines into `docs/PROGRESS.md`.
- If a check needs hardware or a service you cannot run, label it `UNVERIFIED-HW`. Never convert UNVERIFIED into PASS.

## No fabrication
- Do not invent package names, versions, CLI flags, API signatures, config keys, or URLs.
- Before using any dependency or flag, verify it: `npm view`, `pip index versions`, `docker manifest inspect`, `ffmpeg -h filter=<name>`, `<tool> --help`, or official docs. Version numbers in the spec/source are **targets to verify**, not facts.
- Pin exact versions in lockfiles. Record the verified versions in `docs/VERSIONS.md`.

## No placeholders
Forbidden in committed code: `TODO`, `FIXME`, "rest of code here", empty stubs, `pass`-bodies, fake success responses, hardcoded secrets, commented-out code, mock data in production paths. Write every file in full. Mocks live only under `tests/` or the dev simulator and are labeled.

## Small steps
One task at a time. After each: lint → typecheck → tests → commit. Do not start the next phase before the Gate passes. No drive-by refactors, no dependency swaps without a DECISIONS entry, no edits outside the current task's scope.

## Never game the tests
Do not delete/skip/loosen tests, use `--no-verify`, blanket `eslint-disable`, `@ts-ignore`, `except: pass`, or catch-and-ignore. A failing test means fix the code, or log why the requirement is wrong and ask.

## Data safety
- Raw recordings may be deleted only by the verification pipeline (spec §8.6) after `verified_at` is set.
- No `rm -rf`, `docker system prune`, `DROP`, `TRUNCATE` except on test containers/temp dirs you created. Ask before system-wide installs.
- Never touch paths outside the workspace and `/data` volumes.

## Process and shell safety
- Spawn external processes with argument arrays — never build shell strings from variables.
- Every external process has a timeout and is killed as a process group on cancel/shutdown.
- Start servers/watchers in background terminals; never block on a command that waits forever. If a command hangs > 3 minutes, kill it, diagnose, change approach. Never re-run the identical failing command more than twice.

## Secrets and privacy
Secrets only in `.env` (commit `.env.example`). RTSP URLs contain credentials: encrypt at rest, mask in logs, never send to the frontend.

## Loop breaker
Same error 3 times, or 2 failed gate attempts → stop, write `docs/BLOCKERS.md` (what you tried, outputs, hypotheses), ask the user.

## Hardware honesty
NVENC / NVDEC / libvmaf_cuda / TensorRT behavior is proven only by running on the real RTX 4060. CPU fallbacks are separate code paths with their own tests and are never counted as proof of the GPU path.

## Skills
At the start of every phase list installed skills (`.agents/skills`, `.agent/skills`, `~/.gemini/antigravity/skills`), read matching `SKILL.md` files, and follow them. Log usage in `docs/PROGRESS.md`.

## Ask vs decide
Ask the user only for: missing credentials/hardware access, licensing choices, anything that could destroy user data, or an architecture-affecting ambiguity the spec does not resolve. Otherwise decide, log in DECISIONS.md, continue.

## Communication
Code, comments, commits, docs in English. Status messages short and factual. Every gate ends with the Gate Report template (spec Appendix C).
