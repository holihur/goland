import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { I18nProvider } from "@/lib/i18n";
import { ThemeProvider } from "@/lib/theme";
import { SettingsDialog } from "./SettingsDialog";

function renderDialog(open = true) {
  return render(
    <I18nProvider>
      <ThemeProvider>
        <SettingsDialog open={open} onOpenChange={() => undefined} />
      </ThemeProvider>
    </I18nProvider>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove("dark");
});

describe("SettingsDialog", () => {
  it("switches theme and language from one settings surface", async () => {
    renderDialog();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Appearance")).toBeInTheDocument();
    expect(screen.getByLabelText("Language")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Light theme" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem("goland.theme")).toBe("light");

    fireEvent.change(screen.getByLabelText("Language"), { target: { value: "zh" } });
    await waitFor(() => expect(screen.getByText("设置")).toBeInTheDocument());
    expect(document.documentElement.lang).toBe("zh-CN");
  });

  it("renders all supported languages", () => {
    renderDialog();
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual([
      "English",
      "中文",
      "हिन्दी",
      "Español",
      "Français",
      "العربية",
      "বাংলা",
      "Português",
      "Русский",
      "اردو",
    ]);
  });

  it("does not render content when closed", () => {
    renderDialog(false);
    expect(screen.queryByText("Settings")).not.toBeInTheDocument();
  });
});
