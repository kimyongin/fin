#!/usr/bin/env python3
"""Package the editable plugin using the canonical Portfolio skill source."""
import json
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED

root = Path(__file__).resolve().parents[1]
candidate = root / "plugins/portfolio-workflow"
canonical = root / "plugins/portfolio"
manifest = json.loads((candidate / "plugin.json").read_text(encoding="utf-8"))
interface = manifest["extensions"]["com.openai"]["interface"]
assert len(interface["shortDescription"]) <= 30
legacy = {key: manifest[key] for key in ("name", "version", "description", "author")}
legacy.update(apps="./.app.json", skills="./skills", interface=interface)
files = {
    "plugin.json": (candidate / "plugin.json").read_bytes(),
    ".app.json": (canonical / ".app.json").read_bytes(),
    ".codex-plugin/plugin.json": (json.dumps(legacy, ensure_ascii=False, indent=2) + "\n").encode(),
}
for path in sorted((canonical / "skills").rglob("*")):
    if path.is_file() and "__pycache__" not in path.parts and path.suffix != ".pyc":
        files[path.relative_to(canonical).as_posix()] = path.read_bytes()
archive = root / "artifacts" / f"portfolio-workflow-{manifest['version']}.zip"
archive.parent.mkdir(exist_ok=True)
with ZipFile(archive, "w", ZIP_DEFLATED) as output:
    for path, data in files.items():
        assert not data.startswith(b"\xef\xbb\xbf") and b"\r" not in data, path
        data.decode("utf-8")
        output.writestr(f"{manifest['name']}/{path}", data)
with ZipFile(archive) as output:
    assert output.testzip() is None
    for path, data in files.items():
        assert output.read(f"{manifest['name']}/{path}") == data
print(json.dumps({"archive": str(archive), "version": manifest["version"], "files": len(files)}, ensure_ascii=False))
