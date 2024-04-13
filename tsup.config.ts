import { defineConfig } from "tsup"

export default defineConfig({
	entry: ["src/extension.ts"],
	outDir: "out",
	bundle: true,
	clean: true,
	format: "cjs",
	external: ["vscode"],
})
