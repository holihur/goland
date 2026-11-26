      (function () {
        try {
          var theme = localStorage.getItem("goland.theme");
          if (theme !== "light" && theme !== "dark") {
            theme = window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
          }
          document.documentElement.classList.toggle("dark", theme === "dark");
          document.documentElement.style.colorScheme = theme;
          var lang = localStorage.getItem("goland.lang");
          if (lang !== "en" && lang !== "zh") {
            lang = (navigator.language || "").toLowerCase().indexOf("zh") === 0 ? "zh" : "en";
          }
          document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
        } catch (error) {
          document.documentElement.classList.add("dark");
        }
      })();
