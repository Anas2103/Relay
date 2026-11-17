import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

/** One id per build. The app compares it with /version.json to notice a new deploy. */
const BUILD_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function versionFile(): Plugin {
  return {
    name: "relay-version-file",
    generateBundle() {
      // Only the browser bundle (it becomes the static assets), not the Worker.
      if (this.environment?.name !== "client") return;
      this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  build: {
    rolldownOptions: {
      output: {
        // React rarely changes, so it gets its own file that stays cached across Relay updates.
        codeSplitting: { groups: [{ name: "react", test: /node_modules\/(react|react-dom|scheduler)\// }] },
      },
    },
  },
  // In CI there's no Cloudflare login, so remote-only bindings (Workers AI) are left out.
  plugins: [react(), tailwindcss(), cloudflare({ remoteBindings: !process.env.CI }), versionFile()],
});
