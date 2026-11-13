vim.lsp.enable({ "tsc", "oxlint" })

if vim.fn.executable("nix") == 1 then
    for name, cmd in pairs({
        bashls = { "nix", "shell", "nixpkgs#bash-language-server", "-c", "bash-language-server", "start" },
        jsonls = { "nix", "shell", "nixpkgs#vscode-langservers-extracted", "-c", "vscode-json-language-server", "--stdio" },
    }) do
        vim.lsp.config(name, { cmd = cmd })
        vim.lsp.enable(name)
    end
end
