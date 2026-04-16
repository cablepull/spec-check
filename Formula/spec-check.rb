class SpecCheck < Formula
  desc "Spec-driven development gate system for LLM-driven tools"
  homepage "https://github.com/cablepull/spec-check"
  url "https://github.com/cablepull/spec-check/archive/refs/tags/v0.1.1.tar.gz"
  sha256 "PLACEHOLDER"
  license "MIT"

  bottle do
    root_url "https://github.com/cablepull/spec-check/releases/download/v0.1.1"
    # Bottles must be rebuilt after node@22 → node@24 and duckdb 0.10 → 1.4.4 bump
  end

  depends_on "node@24"

  def install
    ENV.prepend_path "PATH", Formula["node@24"].opt_bin
    # Install all deps (including devDeps for tsc), compile TypeScript, then prune
    system "npm", "ci"
    system "npm", "run", "build"
    system "npm", "prune", "--omit=dev"

    libexec.install Dir["*"]

    (bin/"spec-check").write <<~SH
      #!/bin/sh
      exec "#{Formula["node@24"].opt_bin}/node" "#{libexec}/dist/cli.js" "$@"
    SH
  end

  def caveats
    <<~EOS
      spec-check has been installed. To configure your LLM tool, run:

        spec-check init --tool claude --path .

      Supported tools: claude, cursor, gemini, codex, ollama

      To configure all detected tools at once:

        spec-check init --all --path .

      To register spec-check as an MCP server in Claude, add the following
      to your MCP configuration, then restart Claude:

        {
          "mcpServers": {
            "spec-check": {
              "command": "spec-check",
              "args": []
            }
          }
        }

      Or run `spec-check init --tool claude --path <project>` to write it automatically.

      For the local HTTP API and dashboard:

        spec-check server --path .
    EOS
  end

  test do
    assert_match "0.1.1", shell_output("#{bin}/spec-check --version")
    assert_match "spec-check", shell_output("#{bin}/spec-check --help")
  end
end
