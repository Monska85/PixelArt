import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";
import { IconButton } from "../components/icon-button";
import { theme, useTheme, type ThemeChoice } from "../theme";

const CYCLE: Array<{ value: ThemeChoice; label: string; icon: LucideIcon }> = [
  { value: "system", label: "System", icon: Monitor },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "light", label: "Light", icon: Sun },
];

/** One icon button: it shows the current theme and each click moves on, System then Dark then Light then System. */
export function ThemeButton() {
  const choice = useTheme();
  const index = CYCLE.findIndex((c) => c.value === choice);
  const current = CYCLE[index]!;
  const next = CYCLE[(index + 1) % CYCLE.length]!;
  const text = `Theme: ${current.label}. Click for ${next.label}.`;
  return (
    <IconButton
      label={text}
      tooltip={text}
      icon={current.icon}
      variant="outline"
      data-testid="theme-button"
      onClick={() => theme.set(next.value)}
    />
  );
}
