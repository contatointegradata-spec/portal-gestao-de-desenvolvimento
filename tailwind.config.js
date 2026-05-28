export default {
  content: ["./index.html", "./src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        base: {
          900: "rgb(var(--base-900) / <alpha-value>)",
          800: "rgb(var(--base-800) / <alpha-value>)",
          700: "rgb(var(--base-700) / <alpha-value>)"
        },
        ink: {
          100: "rgb(var(--ink-100) / <alpha-value>)",
          300: "rgb(var(--ink-300) / <alpha-value>)",
          400: "rgb(var(--ink-400) / <alpha-value>)"
        },
        accent: {
          500: "rgb(var(--accent-500) / <alpha-value>)",
          600: "rgb(var(--accent-600) / <alpha-value>)"
        }
      },
      boxShadow: {
        soft: "0 14px 36px rgba(5, 150, 105, 0.12)",
        glow: "0 0 0 1px rgba(34, 197, 94, 0.14), 0 20px 40px rgba(16, 185, 129, 0.12)"
      },
      borderRadius: {
        xl: "18px"
      }
    }
  },
  plugins: []
};
