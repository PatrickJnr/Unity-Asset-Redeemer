# Contributing

Thank you for improving Unity Asset Redeemer. Keep changes focused, maintainable, and compatible with a directly installable userscript.

## Before opening a pull request

1. Create a branch from `main`.
2. Preserve the canonical userscript at the repository root.
3. Do not add credentials, cookies, CSRF tokens, account data, or captured private responses.
4. Add or update offline tests for changed behavior.
5. Run `npm ci` and `npm run validate`.
6. Update `CHANGELOG.md` for user-visible changes.

Do not make automated tests contact Unity or require an authenticated account. Mock network behavior and page markup. Keep runtime code dependency-free and avoid a build step.

## Style

- Use modern, readable JavaScript.
- Preserve the existing claiming flow unless evidence supports a change.
- Treat unknown API outcomes as failures, never confirmed ownership.
- Keep retries bounded and stop controls responsive.
- Use the slate and neutral-grey interface palette with border radii no greater than 4px.
- Maintain keyboard access, visible focus states and reduced-motion support.

## Versioning and releases

Maintainers use semantic versioning. A userscript version is published only after validation passes. Keep `@version`, `package.json`, the changelog heading, Git tag and GitHub release aligned.

By contributing inherited or modified project material, you agree that it is distributed under CC BY-NC-SA 4.0 and that required attribution is preserved.
