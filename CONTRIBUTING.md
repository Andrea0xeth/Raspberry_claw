# Contributing to Raspberry Claw

Thank you for considering contributing. This document gives a short workflow and conventions.

## How to contribute

1. **Fork** the repository and clone your fork.
2. **Create a branch** from `main` (e.g. `fix/telegram-timeout`, `docs/quickstart`).
3. **Make your changes** — keep commits focused and messages clear.
4. **Test** locally if possible (e.g. run `openclaw` with `npm start`, or run scripts on a Pi).
5. **Open a Pull Request** against `main` with a short description and, if relevant, link to an issue.

## What we welcome

- **Bug fixes** (agent, Telegram bridge, cron, Factor MCP, scripts).
- **Documentation** (README, docs/, comments) in English or Italian.
- **New skills** (Markdown in `openclaw/skills/`) or small tools that fit the agent.
- **Improvements** to setup scripts (scripts/*) and systemd configs (config/systemd/).
- **Ideas** — open an issue first to discuss bigger changes or new features.

## Conventions

- **Code**: JavaScript/Node in `openclaw/src/`; shell scripts in `scripts/`. Prefer existing style (indentation, naming).
- **Docs**: Markdown in repo root or `docs/`. Main README is in English; we keep `README.it.md` for the full Italian setup.
- **Secrets**: Never commit API keys, tokens, or passwords. Use env vars or local config files (see `.gitignore`).
- **Commits**: Prefer present tense and clear scope (e.g. `Add timeout to Telegram bridge`, `Fix cron BTC Discord 404`).

## Pull request process

- Target branch: `main`.
- PR title and description should explain what and why.
- Maintainers may ask for changes or merge after review. No formal CLA; by contributing you agree your contributions are under the project’s MIT license.

## Questions

- Open a [GitHub Discussion](https://github.com/Andrea0xeth/Raspberry_claw/discussions) for questions or ideas.
- Open an [Issue](https://github.com/Andrea0xeth/Raspberry_claw/issues) for bugs or feature requests.

Thank you for helping make Raspberry Claw better for everyone.
