// Breadcrumb path (web-ui spec): vdir root + one tappable link per
// path segment; the current segment is not a link (aria-current).

import { Link } from "react-router";
import { browseUrl, pathSegments } from "../lib/listing";

export function Breadcrumbs({
  vdirId,
  vdirName,
  path,
}: {
  vdirId: string;
  vdirName: string;
  path: string;
}) {
  const segments = pathSegments(path);
  return (
    <nav
      aria-label="Breadcrumb"
      data-testid="breadcrumbs"
      className="truncate text-[12px] font-medium text-ios-secondary/70"
    >
      <Link
        to={browseUrl(vdirId, "")}
        aria-current={segments.length === 0 ? "page" : undefined}
        className="hover:text-ios-blue"
      >
        {vdirName || vdirId}
      </Link>
      {segments.map((segment, i) => (
        <span key={segment.path}>
          <span className="mx-1 text-ios-secondary/30">/</span>
          {i === segments.length - 1 ? (
            <span aria-current="page" className="font-semibold text-ios-label">
              {segment.name}
            </span>
          ) : (
            <Link to={browseUrl(vdirId, segment.path)} className="hover:text-ios-blue">
              {segment.name}
            </Link>
          )}
        </span>
      ))}
    </nav>
  );
}
