class SpecCheck < Formula
  desc "Spec-driven development gate system for LLM-driven tools"
  homepage "https://github.com/cablepull/spec-check"
  url "https://github.com/cablepull/spec-check/archive/refs/tags/v0.1.1.tar.gz"
  sha256 "5026e10c276cdb9471a7bf035b5198ebd33a1a6fa1b72d88ad0c3ed14432436d"
  license "MIT"

  bottle do
    root_url "https://github.com/cablepull/spec-check/releases/download/v0.1.1"
    sha256 cellar: :any_skip_relocation, arm64_sequoia: "0f757f96c0eea8f6c5fc131d7912ff92d031188c66f8f4362ad11b8567ce13f2"
    sha256 cellar: :any_skip_relocation, arm64_sonoma: "970baeece09f47b4482c484e5385481c404d464f54694da9809ff3c8755aa8ca"
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
