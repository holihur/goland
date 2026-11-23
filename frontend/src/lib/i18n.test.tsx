import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider, LanguageToggle, languages, useI18n } from "./i18n";

function Probe() {
  const { language, t, setLanguage } = useI18n();
  return (
    <div>
      <span data-testid="language">{language}</span>
      <span data-testid="greeting">{t("home.greeting", { name: "Ada" })}</span>
      <span data-testid="missing-var">{t("home.greeting")}</span>
      <span data-testid="count">{t("home.workspaceCountPlural", { count: 2 })}</span>
      <button onClick={() => setLanguage("ar")}>arabic</button>
    </div>
  );
}

beforeEach(() => {
  window.localStorage.clear();
});

describe("I18nProvider", () => {
  it("defaults to English and interpolates variables", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("language")).toHaveTextContent("en");
    expect(screen.getByTestId("greeting")).toHaveTextContent("Good to see you, Ada.");
    expect(screen.getByTestId("missing-var")).toHaveTextContent("Good to see you, {name}.");
    expect(screen.getByTestId("count")).toHaveTextContent("2 workspaces");
    expect(document.documentElement.lang).toBe("en");
  });

  it("switches language, writes storage, and sets RTL", () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    fireEvent.click(screen.getByText("arabic"));
    expect(screen.getByTestId("language")).toHaveTextContent("ar");
    expect(document.documentElement.lang).toBe("ar");
    expect(document.documentElement.dir).toBe("rtl");
    expect(window.localStorage.getItem("goland.lang")).toBe("ar");
  });

  it("restores a stored language", () => {
    window.localStorage.setItem("goland.lang", "zh");
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByTestId("language")).toHaveTextContent("zh");
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("provides the top 10 languages with translated messages", () => {
    expect(languages.map((item) => item.id)).toEqual([
      "en",
      "zh",
      "hi",
      "es",
      "fr",
      "ar",
      "bn",
      "pt",
      "ru",
      "ur",
    ]);
    expect(languages.filter((item) => item.dir === "rtl").map((item) => item.id)).toEqual(["ar", "ur"]);
    for (const language of languages) {
      function LanguageProbe() {
        const { t } = useI18n();
        return <span data-testid={`text-${language.id}`}>{t("login.signIn")}</span>;
      }
      window.localStorage.setItem("goland.lang", language.id);
      const { unmount } = render(
        <I18nProvider>
          <LanguageProbe />
        </I18nProvider>,
      );
      expect(screen.getByTestId(`text-${language.id}`)).not.toHaveTextContent("login.signIn");
      unmount();
    }
  });

  it("changes language from the toggle", () => {
    render(
      <I18nProvider>
        <LanguageToggle />
        <Probe />
      </I18nProvider>,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "fr" } });
    expect(screen.getByTestId("language")).toHaveTextContent("fr");
    expect(screen.getByTestId("greeting")).toHaveTextContent("Ravi de vous revoir, Ada.");
  });
});
