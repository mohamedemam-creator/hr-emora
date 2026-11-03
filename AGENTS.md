## Token Efficiency

- Use only the skills relevant to the current task.
- Never load or apply all skills by default.
- Read only files directly related to the task.
- Prefer targeted searches over scanning the entire repository.
- Do not re-read files unless they have changed or are necessary.
- Avoid repeating information already documented in project files.
- Keep explanations and progress updates concise.
- Do not expand the task scope without asking.
- Run only the tests needed to validate the changes.
- Avoid unnecessary builds and repeated commands.
- Before large tasks, create a concise implementation plan.
- Summarize completed work, changed files, and remaining issues briefly.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
