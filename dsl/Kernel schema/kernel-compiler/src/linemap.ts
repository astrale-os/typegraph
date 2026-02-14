// src/linemap.ts
// ============================================================
// LineMap — Bidirectional Offset ↔ Line:Col Mapping
//
// Built once per source string. Used by the CLI for error
// rendering and by the LSP for position conversion.
//
// Lines and columns are 0-indexed (matching LSP convention).
// ============================================================

export interface Position {
  line: number;
  col: number;
}

export class LineMap {
  /** Byte offset of the start of each line. */
  private lineStarts: number[];
  private source: string;

  constructor(source: string) {
    this.source = source;
    this.lineStarts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source[i] === "\n") {
        this.lineStarts.push(i + 1);
      }
    }
  }

  get lineCount(): number {
    return this.lineStarts.length;
  }

  /** Convert byte offset → {line, col} (0-indexed). */
  positionAt(offset: number): Position {
    // Binary search for the line
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.lineStarts[mid] <= offset) {
        low = mid;
      } else {
        high = mid - 1;
      }
    }
    return {
      line: low,
      col: offset - this.lineStarts[low],
    };
  }

  /** Convert {line, col} (0-indexed) → byte offset. */
  offsetAt(line: number, col: number): number {
    if (line < 0) return 0;
    if (line >= this.lineStarts.length) {
      return this.source.length;
    }
    return this.lineStarts[line] + col;
  }

  /** Get the text of a specific line (without newline). */
  lineText(line: number): string {
    if (line < 0 || line >= this.lineStarts.length) return "";
    const start = this.lineStarts[line];
    const end = line + 1 < this.lineStarts.length
      ? this.lineStarts[line + 1] - 1  // exclude \n
      : this.source.length;
    return this.source.slice(start, end);
  }
}
