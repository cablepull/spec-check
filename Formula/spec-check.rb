class SpecCheck < Formula
  desc "Spec-driven development gate system for LLM-driven tools"
  homepage "https://github.com/cablepull/spec-check"
  url "https://github.com/cablepull/spec-check/archive/refs/tags/v0.1.0.tar.gz"
  sha256 "8ca505d38db6c8fea3d7bd1e6a2fce89d2215dbc97ef22e4613b4584722d578f"
  license "MIT"

  bottle do
    root_url "https://github.com/cablepull/spec-check/releases/download/v0.1.0"
    sha256 cellar: :any_skip_relocation, arm64_sequoia: "98950f2a7425488a1787e9c233a9609d94fa6119c10d036dcae5f1724336e163"
    sha256 cellar: :any_skip_relocation, arm64_sonoma: "0908fcd470c5901e18d5223101324b83073b60e0b07e2231cd280edf0cca6448"
  end

  depends_on "node@22"

  def install
    # Install all deps (including devDeps for tsc), compile TypeScript, then prune
    system "npm", "ci"
    system "npm", "run", "build"
    system "npm", "prune", "--omit=dev"

    libexec.install Dir["*"]

    (bin/"spec-check").write <<~SH
      #!/bin/sh
      exec "#{Formula["node@22"].opt_bin}/node" "#{libexec}/dist/cli.js" "$@"
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
    assert_match "0.1.0", shell_output("#{bin}/spec-check --version")
    assert_match "spec-check", shell_output("#{bin}/spec-check --help")
  end
end
