import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {},
  },
  plugins: [require("daisyui")],
  daisyui: {
    themes: [
      {
        // Custom branded theme — a WhatsApp-inspired emerald/teal palette.
        wa: {
          primary: "#16a34a",
          "primary-content": "#ffffff",
          secondary: "#0ea5e9",
          accent: "#8b5cf6",
          neutral: "#1f2937",
          "base-100": "#ffffff",
          "base-200": "#f4f6f9",
          "base-300": "#e5e9f0",
          "base-content": "#1a2233",
          info: "#0ea5e9",
          success: "#16a34a",
          warning: "#f59e0b",
          error: "#ef4444",
          "--rounded-box": "1rem",
          "--rounded-btn": "0.6rem",
        },
      },
      "light",
      "dark",
    ],
  },
};

export default config;
