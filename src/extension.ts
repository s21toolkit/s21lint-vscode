import type * as s21lint from "@s21toolkit/lint"
import * as vscode from "vscode"
import type Parser from "web-tree-sitter"

const ALLOWED_LANGUAGE_IDS = ["cpp", "c"]

function isAllowedDocument(document: vscode.TextDocument) {
	return ALLOWED_LANGUAGE_IDS.includes(document.languageId)
}

export async function activate(context: vscode.ExtensionContext) {
	// TODO Fix this ESM/CJS mess
	const s21lint = await import("@s21toolkit/lint")

	const diagnostics = vscode.languages.createDiagnosticCollection("s21lint")

	context.subscriptions.push(diagnostics)

	const parser = await s21lint.createParser("cpp")
	const programs = new Map<string, Parser.Tree>()

	const linter = new s21lint.Linter({ rules: s21lint.rules })

	function parseDocument(document: vscode.TextDocument) {
		const program = parser.parse(document.getText())

		programs.set(document.fileName, program)

		return program
	}

	function lintDocument(document: vscode.TextDocument) {
		const program = programs.get(document.fileName)

		if (!program) {
			return
		}

		linter.checkProgram(program, document.fileName)
	}

	function disposeDocument(document: vscode.TextDocument) {
		programs.delete(document.fileName)
		linter.clearFileDiagnostics(document.fileName)

		diagnostics.delete(document.uri)
	}

	function reportDocumentDiagnostics(document: vscode.TextDocument) {
		function convertDiagnostic(
			linterDiagnostic: s21lint.Diagnostic,
		): vscode.Diagnostic {
			const range = new vscode.Range(
				linterDiagnostic.node.startPosition.row,
				linterDiagnostic.node.startPosition.column,
				linterDiagnostic.node.endPosition.row,
				linterDiagnostic.node.endPosition.column,
			)

			const severity = {
				warning: vscode.DiagnosticSeverity.Warning,
				error: vscode.DiagnosticSeverity.Error,
			}[linterDiagnostic.severity]

			return {
				message: linterDiagnostic.message,
				range,
				severity,
				source: `s21lint(${linterDiagnostic.reporter.name})`,
			}
		}

		const linterDiagnostics = linter.getFileDiagnostics(document.fileName)
		const editorDiagnostics: vscode.Diagnostic[] = []

		for (const diagnostic of linterDiagnostics) {
			editorDiagnostics.push(convertDiagnostic(diagnostic))
		}

		diagnostics.set(document.uri, editorDiagnostics)
	}

	vscode.window.onDidChangeActiveTextEditor((editor) => {
		if (!editor || !isAllowedDocument(editor.document)) {
			return
		}

		parseDocument(editor.document)
		lintDocument(editor.document)
		reportDocumentDiagnostics(editor.document)
	})

	vscode.workspace.onDidCloseTextDocument((document) => {
		disposeDocument(document)
	})

	vscode.workspace.onDidChangeTextDocument((event) => {
		if (!isAllowedDocument(event.document)) {
			return
		}

		const program = programs.get(event.document.fileName)

		// If the document has not been parsed yet, simply parse it and lint it
		if (!program) {
			parseDocument(event.document)
			lintDocument(event.document)
			reportDocumentDiagnostics(event.document)

			return
		}

		// Otherwise, we need to update the tree based on the document changes to perform incremental parsing

		// Iterate over document edits from the end of the document (default ordering)
		for (const change of event.contentChanges) {
			const oldEndIndex = change.rangeOffset + change.rangeLength

			const newEndIndex = change.rangeOffset + change.text.length
			const newEndPosition = event.document.positionAt(newEndIndex)

			// Convert vscode changes to tree sitter edits and apply them to the tree to update node positions
			program.edit({
				startIndex: change.rangeOffset,
				startPosition: {
					row: change.range.start.line,
					column: change.range.start.character,
				},
				oldEndIndex,
				oldEndPosition: {
					row: change.range.end.line,
					column: change.range.end.character,
				},
				newEndIndex,
				newEndPosition: {
					row: newEndPosition.line,
					column: newEndPosition.character,
				},
			})
		}

		// Reparse the document with the updated tree
		const newProgram = parser.parse(event.document.getText(), program)

		programs.set(event.document.fileName, newProgram)

		lintDocument(event.document)
		reportDocumentDiagnostics(event.document)
	})
}
