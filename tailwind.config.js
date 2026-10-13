export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Identidade Integradata: azul do simbolo (600) sobre o azul-marinho do fundo da logo (950).
        brand: {
          50: "#eeefff",
          100: "#e0e1ff",
          200: "#c6c7ff",
          300: "#a3a2fd",
          400: "#7f7bf9",
          500: "#5d56f6",
          600: "#3e39f5",
          700: "#2f28d8",
          800: "#2620ae",
          900: "#1a1683",
          950: "#0a0849"
        },
        // Verde-limao do "DATA" e do contorno da logo — usado como destaque.
        accent: {
          50: "#f4fde8",
          100: "#e6fbcd",
          200: "#cdf6a1",
          300: "#acee6a",
          400: "#8ee03c",
          500: "#6fcb16",
          600: "#55a20d",
          700: "#427b10",
          800: "#376113",
          900: "#2f5215",
          950: "#162d05"
        }
      },
      fontFamily: {
        sans: ["Sora", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        brand: ["Merriweather", "Georgia", "serif"],
        mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "Consolas", "monospace"]
      },
      boxShadow: {
        soft: "0 10px 30px -12px rgba(10, 8, 73, 0.18)",
        pop: "0 24px 60px -20px rgba(10, 8, 73, 0.35)"
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
