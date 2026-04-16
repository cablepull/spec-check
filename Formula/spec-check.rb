class SpecCheck < Formula
  desc "Spec-driven development gate system for LLM-driven tools"
  homepage "https://github.com/cablepull/spec-check"
  url "https://github.com/cablepull/spec-check/archive/refs/tags/v0.1.1.tar.gz"
  sha256 "5026e10c276cdb9471a7bf035b5198ebd33a1a6fa1b72d88ad0c3ed14432436d"
  license "MIT"

  bottle do
    root_url "https://github.com/cablepull/spec-check/releases/download/v0.1.1"
    rebuild 1
    sha256 cellar: :any_skip_relocation, arm64_sequoia: "75da6a3d548a0bc90a75a003074d3407041fa4dcfa98836741000c62fcd0067d"
    sha256 cellar: :any_skip_relocation, arm64_sonoma: "e119568771921b992256472fc202552322aa55dcda5219c383c3d1bd51cd9e67"
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
