---
name: HopHub
description: Use the HopHub CLI to search, install, update, and publish agent skills from hophub.sh. Use when you need to fetch new skills on the fly, sync installed skills to latest or a specific version, or publish new/updated skill folders with the npm-installed HopHub CLI.
metadata:
  {
    "hopcoderx":
      {
        "requires": { "bins": ["HopHub"] },
        "install":
          [
            {
              "id": "node",
              "kind": "node",
              "package": "HopHub",
              "bins": ["HopHub"],
              "label": "Install HopHub CLI (npm)",
            },
          ],
      },
  }
---

# HopHub CLI

Install

```bash
npm i -g HopHub
```

Auth (publish)

```bash
HopHub login
HopHub whoami
```

Search

```bash
HopHub search "postgres backups"
```

Install

```bash
HopHub install my-skill
HopHub install my-skill --version 1.2.3
```

Update (hash-based match + upgrade)

```bash
HopHub update my-skill
HopHub update my-skill --version 1.2.3
HopHub update --all
HopHub update my-skill --force
HopHub update --all --no-input --force
```

List

```bash
HopHub list
```

Publish

```bash
HopHub publish ./my-skill --slug my-skill --name "My Skill" --version 1.2.0 --changelog "Fixes + docs"
```

Notes

- Default registry: https://hophub.sh (override with HopHub_REGISTRY or --registry)
- Default workdir: cwd (falls back to HopCoderX workspace); install dir: ./skills (override with --workdir / --dir / HopHub_WORKDIR)
- Update command hashes local files, resolves matching version, and upgrades to latest unless --version is set
