/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: {
          bg: "#0d1117",
          surface: "#161b22",
          raised: "#21262d",
          line: "#21262d",
          border: "#30363d",
          text: "#e6edf3",
          muted: "#7d8590",
          subtle: "#484f58",
          blue: "#388bfd",
          blueStrong: "#1f6feb",
          green: "#3fb950",
          orange: "#f0883e",
          orangeDark: "#db6d28",
          violet: "#a78bfa",
          danger: "#da3633",
          cyan: "#39c5cf",
          yellow: "#f2cc60",
        },
      },
      fontFamily: {
        sans: ["Segoe UI", "Inter", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
