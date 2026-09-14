import type { ToolCallContent } from "@/core";
import {
  type Color,
  dim,
  renderHighlightedLine,
  splitLines,
  truncateToWidth,
  visibleWidth,
  wrapHighlightedLine,
} from "../../render";
import { tuiTheme } from "../../theme";
import { highlightCodeSync, inferCodeLanguage } from "../../utils/syntax-highlighter";
import { COMPACT_EDIT_LINE_LIMIT } from "../compact";
import { getArrayProperty, getNumberProperty, getStringProperty } from "../properties";
import type { ToolOutputDetail } from "../types";

export function formatEditOutput(
  toolCall: ToolCallContent,
  result: object,
  detail: ToolOutputDetail,
  width: number,
): string[] {
  const path = getStringProperty(result, "path");
  const replacements = getNumberProperty(result, "replacements");
  const edits = parseEdits(toolCall.args);
  const diffGroups = buildDiffGroups(edits);
  const lines: string[] = [];

  if (replacements !== undefined) {
    lines.push(dim(`${replacements} replacement${replacements === 1 ? "" : "s"}`));
  }

  if (detail === "compact") {
    let remaining = COMPACT_EDIT_LINE_LIMIT;

    for (const group of diffGroups) {
      const visible = group.lines.slice(0, remaining);
      lines.push(
        ...renderDiffLines(visible, group.marker, group.lineBackground, path, detail, width),
      );
      remaining -= visible.length;
      if (remaining === 0) break;
    }

    const totalLines = diffGroups.reduce((total, group) => total + group.lines.length, 0);
    const omittedLines = totalLines - COMPACT_EDIT_LINE_LIMIT;
    if (omittedLines > 0) {
      lines.push(dim(`... ${omittedLines} more lines`));
    }

    return lines;
  }

  for (const group of diffGroups) {
    lines.push(
      ...renderDiffLines(group.lines, group.marker, group.lineBackground, path, detail, width),
    );
  }

  return lines;
}

export function hasExpandableEditOutput(
  toolCall: ToolCallContent,
  width: number | undefined,
): boolean {
  const diffLines = buildDiffGroups(parseEdits(toolCall.args)).flatMap((group) => group.lines);

  if (diffLines.length > COMPACT_EDIT_LINE_LIMIT) {
    return true;
  }

  const contentWidth = width === undefined ? undefined : width - 2;
  return contentWidth !== undefined && diffLines.some((line) => visibleWidth(line) > contentWidth);
}

function parseEdits(args: unknown): Array<{ oldText: string; newText: string }> {
  const edits = getArrayProperty(args, "edits") ?? [];

  return edits.flatMap((edit) => {
    const oldText = getStringProperty(edit, "oldText");
    const newText = getStringProperty(edit, "newText");

    return oldText === undefined || newText === undefined ? [] : [{ oldText, newText }];
  });
}

type DiffGroup = {
  lines: string[];
  marker: "-" | "+";
  lineBackground: Color;
};

function buildDiffGroups(edits: Array<{ oldText: string; newText: string }>): DiffGroup[] {
  return edits.flatMap((edit) => [
    {
      lines: diffSourceLines(edit.oldText),
      marker: "-" as const,
      lineBackground: tuiTheme.diffDeleteBackground,
    },
    {
      lines: diffSourceLines(edit.newText),
      marker: "+" as const,
      lineBackground: tuiTheme.diffInsertBackground,
    },
  ]);
}

function diffSourceLines(value: string): string[] {
  const lines = splitLines(value.trimEnd());

  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines.length ? lines : [""];
}

function renderDiffLines(
  sourceLines: string[],
  marker: DiffGroup["marker"],
  lineBackground: DiffGroup["lineBackground"],
  path: string | undefined,
  detail: ToolOutputDetail,
  width: number,
): string[] {
  // Bound the source before highlighting so a compact preview never pays for
  // highlighting a huge diff it then discards. Compact rows are truncated
  // horizontally instead of wrapped.
  const source =
    detail === "full"
      ? sourceLines.join("\n")
      : sourceLines.map((line) => truncateToWidth(line, Math.max(1, width - 2))).join("\n");
  const renderedSourceLines = splitLines(source);
  const highlighted = highlightCodeSync(source, inferCodeLanguage(path));
  const rendered: string[] = [];

  for (const tokens of highlighted ?? renderedSourceLines.map((text) => [{ text }])) {
    if (detail === "compact") {
      rendered.push(
        renderHighlightedLine(tokens, {
          prefix: `${marker} `,
          background: lineBackground,
          clearToEnd: true,
        }),
      );
      continue;
    }

    // Full rows wrap to the viewer content width so overlong diff lines stay
    // readable instead of being truncated again by the viewer.
    for (const wrapped of wrapHighlightedLine(tokens, Math.max(1, width - 2))) {
      rendered.push(
        renderHighlightedLine(wrapped, {
          prefix: `${marker} `,
          background: lineBackground,
          clearToEnd: true,
        }),
      );
    }
  }

  return rendered;
}
