class SpecCheck < Formula
  desc "Spec-driven development gate system for LLM-driven tools"
  homepage "https://github.com/cablepull/spec-check"
  url "https://registry.npmjs.org/spec-check/-/spec-check-0.1.0.tgz"
  sha256 "0000000000000000000000000000000000000000000000000000000000000000"
  license "MIT"
  version "0.1.0"

  depends_on "node"

  def install
    system "npm", "install", "--prefix", libexec, "--production", "--ignore-scripts"
    # Copy the published package into libexec
    cp_r ".", libexec/"lib"
    system "npm", "install", "--prefix", libexec/"lib", "--production", "--ignore-scripts"

    # Write a shell shim so `spec-check` is on PATH
    (bin/"spec-check").write <<~SH
      #!/bin/sh
      exec "#{Formula["node"].opt_bin}/node" "#{libexec}/lib/dist/cli.js" "$@"
    SH
  end

  def caveats
    <<~EOS
      spec-check has been installed. To configure your LLM tool, run:

        spec-check init --tool claude --path .

      Supported tools: claude, cursor, gemini, codex, ollama

      To configure all detected tools at once:

        spec-check init --all --path .

      To register spec-check as an MCP server in Claude, add the entry
      printed by `spec-check init --tool claude` to your MCP configuration.

      For the HTTP API daemon:

        spec-check server --path .
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/spec-check --version 2>&1", 1)
    assert_match "spec-check", shell_output("#{bin}/spec-check --help 2>&1")
  end
end
