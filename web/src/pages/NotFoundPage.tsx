// Page-not-found (web-ui spec): an unrecognized in-app route with a
// control back to the Files tab.

import { Link } from "react-router";
import { DocIcon } from "../components/icons";

export function NotFoundPage() {
  return (
    <div
      data-testid="page-not-found"
      className="flex min-h-dvh flex-col items-center justify-center px-6 text-center"
    >
      <span className="mb-4 flex h-20 w-20 items-center justify-center rounded-3xl bg-ios-blue/10 text-3xl text-ios-blue">
        <DocIcon />
      </span>
      <h1 className="text-2xl font-bold text-ios-label">Page not found</h1>
      <p className="mt-2 max-w-xs text-sm text-ios-secondary/70">
        The page you requested was moved or does not exist.
      </p>
      <Link
        to="/files"
        className="mt-6 rounded-xl bg-ios-blue px-6 py-3 font-semibold text-white shadow-sm active:scale-95"
      >
        Back to your files
      </Link>
    </div>
  );
}
