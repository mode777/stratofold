// Breadcrumb navigation (web-ui spec): vdir root + one link per path
// segment; the current segment is not a link (aria-current).

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
    <nav aria-label="Breadcrumb" data-testid="breadcrumbs" className="px-3 py-2">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-gray-600">
        <li>
          <Link
            to={browseUrl(vdirId, "")}
            aria-current={segments.length === 0 ? "page" : undefined}
            className="font-medium text-blue-700 hover:underline"
          >
            {vdirName || vdirId}
          </Link>
        </li>
        {segments.map((segment, i) => (
          <li key={segment.path} className="flex items-center gap-1">
            <span aria-hidden="true" className="text-gray-400">
              /
            </span>
            {i === segments.length - 1 ? (
              <span aria-current="page" className="text-gray-800">
                {segment.name}
              </span>
            ) : (
              <Link to={browseUrl(vdirId, segment.path)} className="text-blue-700 hover:underline">
                {segment.name}
              </Link>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
