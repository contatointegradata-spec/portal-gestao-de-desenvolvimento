export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#ecfbf3",
          100: "#d2f5e2",
          200: "#a8eac8",
          300: "#6fd8a6",
          400: "#35bf80",
          500: "#12a866",
          600: "#00995d",
          700: "#007a4b",
          800: "#0a5f3e",
          900: "#084d33",
          950: "#032b1c"
        }
      },
      fontFamily: {
        sans: ["Sora", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        brand: ["Merriweather", "Georgia", "serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Consolas", "monospace"]
      },
      boxShadow: {
        soft: "0 10px 30px -12px rgba(3, 43, 28, 0.18)",
        pop: "0 24px 60px -20px rgba(3, 43, 28, 0.35)"
      },
      keyframes: {
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "slide-up": { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "translateY(0)" } },
        "slide-in-right": { from: { transform: "translateX(100%)" }, to: { transform: "translateX(0)" } },
        wiggle: { "0%, 100%": { transform: "rotate(0)" }, "25%": { transform: "rotate(-12deg)" }, "75%": { transform: "rotate(12deg)" } }
      },
      animation: {
        "fade-in": "fade-in .15s ease-out",
        "slide-up": "slide-up .2s ease-out",
        "slide-in-right": "slide-in-right .25s cubic-bezier(.2,.8,.2,1)",
        wiggle: "wiggle .5s ease-in-out 2"
      }
    }
  },
  plugins: []
};
