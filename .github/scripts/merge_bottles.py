#!/usr/bin/env python3
"""
Merge brew bottle JSON files into a Homebrew formula.

Usage:
  merge_bottles.py <formula.rb> <root_url>

Reads all *.json files in the current directory produced by `brew bottle --json`,
then inserts or replaces the `bottle do ... end` block in the formula.
"""

import glob
import json
import re
import sys


def load_bottles(json_files: list[str]) -> dict[str, str]:
    """Return {os_tag: sha256} from all bottle JSON files."""
    bottles: dict[str, str] = {}
    for path in json_files:
        with open(path) as f:
            data = json.load(f)
        for formula_data in data.values():
            for tag, info in formula_data["bottle"]["tags"].items():
                bottles[tag] = info["sha256"]
    return bottles


def build_bottle_block(root_url: str, bottles: dict[str, str]) -> str:
    lines = ["  bottle do", f'    root_url "{root_url}"']
    # Stable sort: arm64 variants first, then x86_64
    for tag in sorted(bottles, key=lambda t: (not t.startswith("arm64"), t)):
        lines.append(f'    sha256 cellar: :any_skip_relocation, {tag}: "{bottles[tag]}"')
    lines.append("  end")
    return "\n".join(lines)


def patch_formula(formula_path: str, bottle_block: str) -> None:
    with open(formula_path) as f:
        content = f.read()

    existing = re.search(r"^  bottle do\n.*?^  end\n", content, re.MULTILINE | re.DOTALL)
    if existing:
        content = content[: existing.start()] + bottle_block + "\n" + content[existing.end() :]
    else:
        # Insert after the license line
        content = re.sub(
            r"(  license \".*?\"\n)",
            r"\1\n" + bottle_block + "\n",
            content,
        )

    with open(formula_path, "w") as f:
        f.write(content)


def main() -> None:
    if len(sys.argv) < 3:
        print(f"Usage: {sys.argv[0]} <formula.rb> <root_url>", file=sys.stderr)
        sys.exit(1)

    formula_path = sys.argv[1]
    root_url = sys.argv[2]

    json_files = glob.glob("*.json")
    if not json_files:
        print("No bottle JSON files found in current directory.", file=sys.stderr)
        sys.exit(1)

    bottles = load_bottles(json_files)
    if not bottles:
        print("No bottle entries found in JSON files.", file=sys.stderr)
        sys.exit(1)

    bottle_block = build_bottle_block(root_url, bottles)
    patch_formula(formula_path, bottle_block)

    print(f"Patched {formula_path} with {len(bottles)} bottle(s):")
    for tag, sha in sorted(bottles.items()):
        print(f"  {tag}: {sha[:16]}...")


if __name__ == "__main__":
    main()
