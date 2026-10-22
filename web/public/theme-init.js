// Runs before the first paint: a classic script in the head, loaded from the site itself, so the Content Security
// Policy allows it and the page needs no inline script. It applies the remembered theme, or the operating system's
// when none is remembered or the browser refuses storage (the app then keeps the document in step, see theme.ts).
var theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
try {
  var choice = localStorage.getItem("pixelart.theme");
  if (choice === "dark" || choice === "light") theme = choice;
} catch {
  // Storage refused: the operating system's theme stays.
}
document.documentElement.dataset.theme = theme;
