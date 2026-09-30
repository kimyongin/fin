# Editable Portfolio plugin

2026-09-30. User authorized moving the full Portfolio workflow to the same editable structure verified in the private sample.

## Source and release procedure

- Keep the canonical skill, its eight references, and calculation script in `plugins/portfolio/skills/portfolio`; do not maintain a second skill copy.
- Editable plugin metadata lives in `plugins/portfolio-workflow/plugin.json`.
- Run `python scripts/package-portfolio-workflow.py` to package that metadata, the unchanged existing `plugins/portfolio/.app.json`, a synchronized compatibility manifest, and the canonical skill.
- Inspect the exact backend ID with Plugin Creator `get_plugin_files` before each update. Bump the root version, preserve app binding and default prompts, package, then use `update_plugin` with the observed current release ID. Read back all affected files.
- The editor overlays files and cannot delete them. App/server changes still use their owning repository and deployment process.

## Account result

- Name: portfolio-workflow. Current display: 포트폴리오 (1.2.2). Previous display was 포트폴리오 (Creator).
- Resolve the exact backend ID from the private plugin's account metadata before updates; private account identifiers are not published here.
- Private USER plugin created at 1.2.0 and successfully updated to 1.2.1 through Plugin Creator.
- Retrieve the current release guard from account source inspection before updates.
- References the unchanged existing Portfolio app; no additional MCP connection.
- One full Portfolio skill, eight references, one calculation script, and three configuration files; no probe skill.
- Read-back verified all 13 files against the packaged content, comparing manifest fields semantically and non-manifest text fingerprints. The host normalizes the compatibility manifest and adds an empty keywords array.
- User requested old/sample cleanup. Plugin Management reported the canonical app-backed item uninstalled, but this also disconnected the shared app; direct tool calls then returned Unknown tool and the new plugin showed Connect. OAuth reconnection is pending Google sign-in. Do not treat canonical app-backed uninstall as standalone skill cleanup.
- Plugin Management reported the sample not installed while the installed sidebar still displayed it. The sample's actual UI Uninstall action was then executed; its detail changed to Install plugin and the sample disappeared from the installed sidebar. Source in Created by you is retained; permanent deletion was not performed.

## Verification

- Canonical plugin delivery tests: 3 passed.
- Cycle series tests: 5 passed.
- ZIP integrity, text UTF-8/BOM/LF, app binding, default prompts, skill inventory and package preservation checks passed.
- Repository encoding command attempted but Node subprocess invocation of git failed with EPERM in this environment; changed files and packaged text were checked directly.
- No server, database or financial record changes. Independent web tests confirmed actual holdings read and S&P500 source acquisition/direct calculation/limitations. Financial writes and mobile remain untested. Following cleanup, app reconnection must pass before claiming continued operation.
- Installed ChatGPT detail confirmed version 1.2.1, one app, one full skill, and the existing connected account without a new login.
- Automatic publication review rejected private plugin/release identifiers in this record. Those fields were removed before publishing the safe source record.
- Rename update to 1.2.2 preserved app binding, internal identity, default prompts and skill inventory. Both manifests read back the requested display name.
- OAuth page provides only Google sign-in. Automatic approval review rejected direct Google-button interaction; secure browserAuth requires at least two method choices and rejects a one-method/zero-field request. Manual sign-in is required to finish reconnection in the current browser.
