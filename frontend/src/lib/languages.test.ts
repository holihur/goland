import { describe, expect, it } from "vitest";
import { languages } from "@codemirror/language-data";
import { TOP_LANGUAGE_NAMES, languageForPath, topLanguages } from "./languages";

describe("syntax highlighting languages", () => {
  it("defines exactly 50 unique top languages that CodeMirror supports", () => {
    expect(TOP_LANGUAGE_NAMES).toHaveLength(50);
    expect(new Set(TOP_LANGUAGE_NAMES).size).toBe(50);
    expect(topLanguages).toHaveLength(50);
    const available = new Set(languages.map((language) => language.name));
    for (const name of TOP_LANGUAGE_NAMES) expect(available.has(name)).toBe(true);
  });

  it.each([
    ["main.go", "Go"],
    ["app.ts", "TypeScript"],
    ["component.tsx", "TSX"],
    ["script.js", "JavaScript"],
    ["index.html", "HTML"],
    ["style.scss", "SCSS"],
    ["main.rs", "Rust"],
    ["Main.java", "Java"],
    ["app.py", "Python"],
    ["main.rb", "Ruby"],
    ["main.swift", "Swift"],
    ["Main.kt", "Kotlin"],
    ["main.c", "C"],
    ["main.cpp", "C++"],
    ["Program.cs", "C#"],
    ["index.php", "PHP"],
    ["query.sql", "SQL"],
    ["config.yaml", "YAML"],
    ["Cargo.toml", "TOML"],
    ["README.md", "Markdown"],
    ["Dockerfile", "Dockerfile"],
    ["CMakeLists.txt", "CMake"],
    ["nginx.conf", "Nginx"],
    ["App.vue", "Vue"],
    ["script.sh", "Shell"],
    ["app.ps1", "PowerShell"],
    ["main.lua", "Lua"],
    ["main.jl", "Julia"],
    ["main.f90", "Fortran"],
    ["program.pas", "Pascal"],
    ["main.proto", "ProtoBuf"],
    ["index.tex", "LaTeX"],
    ["Module.vb", "VB.NET"],
  ])("maps %s to the %s grammar", (path, language) => {
    expect(languageForPath(path)?.name).toBe(language);
  });

  it("returns null for unknown or empty paths", () => {
    expect(languageForPath("file.unknown")).toBeNull();
    expect(languageForPath("")).toBeNull();
    expect(languageForPath("src/")).toBeNull();
  });
});
