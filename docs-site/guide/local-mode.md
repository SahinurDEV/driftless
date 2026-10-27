# Local mode

![Local architecture](/diagrams/architecture-local.svg)

Full walkthrough: see the repo file `docs/LOCAL-GUIDE.md`.

## Commands

```bash
driftless init
driftless repo add ./my-app
driftless serve
driftless docs generate ./my-app --no-ollama
driftless reindex
driftless test-report ./junit.xml
```

Data lives in `~/.driftless` (or `--data`).
