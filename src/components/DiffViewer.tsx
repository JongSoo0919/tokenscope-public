import { DiffLine } from "../lib/prescriber";

interface Props {
  diff: DiffLine[];
  maxLines?: number;
}

export function DiffViewer({ diff, maxLines = 60 }: Props) {
  const visible = diff.slice(0, maxLines);
  const truncated = diff.length > maxLines;

  return (
    <div className="diff-viewer">
      {visible.map((line, i) => (
        <div key={i} className={`diff-line ${line.type}`}>
          <span className="marker">
            {line.type === "removed" ? "-" : line.type === "added" ? "+" : " "}
          </span>
          <span className="content">{line.content}</span>
        </div>
      ))}
      {truncated && (
        <div className="diff-line context">
          <span className="marker"> </span>
          <span className="content" style={{ color: "var(--muted)" }}>
            … {diff.length - maxLines}줄 더 있음
          </span>
        </div>
      )}
    </div>
  );
}
