# Notes for Claude

- Commits are authored and committed as `Ahmet K. <akadircicek@outlook.com>`.
- Never add `Co-Authored-By`, `Claude-Session` or any other Claude line to commit messages, and no Claude attribution in pull request titles or descriptions. Claude is never a contributor to this repository.
- `npm test` must pass before pushing; it lints the generated ArkTS with ohos-typescript.
- Commit messages follow Conventional Commits: `type(scope): imperative summary` in 72 characters or fewer, then a body of bullets when the change needs explaining. Types: `feat`, `fix`, `docs`, `test`, `refactor`, `perf`, `style`, `build`, `ci`, `chore`. Scopes: `converter`, `parser`, `site`, `seo`, `readme`, `license`, `tests`. One change per commit.
