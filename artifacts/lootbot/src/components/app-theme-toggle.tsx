import { useState } from "react";

const THEME_STORAGE_KEY = "lootbot-app-theme";

export type AppTheme = "dark" | "light" | "glass";

export function getAppTheme(): AppTheme {
  const savedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  return savedTheme === "light" || savedTheme === "glass" ? savedTheme : "dark";
}

export function applyAppTheme(theme: AppTheme) {
  document.documentElement.dataset.theme = theme;
  document.documentElement.classList.toggle("dark", theme !== "light");
}

export function AppThemeToggle({
  label = "مظهر غرفة المعلم",
}: { label?: string } = {}) {
  const [theme, setTheme] = useState<AppTheme>(() => getAppTheme());

  const changeTheme = (nextTheme: AppTheme) => {
    setTheme(nextTheme);
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyAppTheme(nextTheme);
  };

  return (
    <select
      className="tw-button tw-theme-select"
      aria-label={label}
      value={theme}
      onChange={(event) => changeTheme(event.currentTarget.value as AppTheme)}
    >
      <option value="dark">المظهر الداكن</option>
      <option value="light">المظهر الفاتح</option>
      <option value="glass">المظهر الزجاجي</option>
    </select>
  );
}
