import { LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";

/**
 * Most common languages, in priority order. These are matched before the rest
 * of CodeMirror's language catalog so ambiguous extensions resolve predictably.
 */
export const TOP_LANGUAGE_NAMES = [
  "JavaScript",
  "TypeScript",
  "Python",
  "Java",
  "C",
  "C++",
  "C#",
  "Go",
  "Rust",
  "PHP",
  "Ruby",
  "Swift",
  "Kotlin",
  "Scala",
  "Dart",
  "R",
  "Lua",
  "Perl",
  "Haskell",
  "Objective-C",
  "Shell",
  "PowerShell",
  "SQL",
  "HTML",
  "CSS",
  "SCSS",
  "Sass",
  "LESS",
  "XML",
  "JSON",
  "YAML",
  "TOML",
  "Markdown",
  "Dockerfile",
  "Vue",
  "JSX",
  "TSX",
  "CMake",
  "Groovy",
  "CoffeeScript",
  "Clojure",
  "Erlang",
  "Julia",
  "Fortran",
  "Pascal",
  "ProtoBuf",
  "Nginx",
  "WebAssembly",
  "LaTeX",
  "VB.NET",
] as const;

const topNames = new Set<string>(TOP_LANGUAGE_NAMES);

export const topLanguages = languages.filter((language) => topNames.has(language.name));

/**
 * Finds the CodeMirror language description for a workspace path. The actual
 * grammar is only fetched when `description.load()` is called by the editor.
 */
export function languageForPath(path: string): LanguageDescription | null {
  const filename = path.split("/").pop() ?? "";
  if (!filename) return null;
  return (
    LanguageDescription.matchFilename(topLanguages, filename) ??
    LanguageDescription.matchFilename(languages, filename)
  );
}
