import { useState } from "react";

// Custom hook for managing theme
export default function useTheme() {
    const [darkMode, setDarkMode] = useState(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
    return { darkMode, setDarkMode };
}
