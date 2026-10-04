import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <div className="p-6 text-center text-gray-600" data-testid="state-notfound">
      <p className="text-lg font-medium text-gray-800">Page not found</p>
      <p className="mt-1 text-sm">
        <Link to="/" className="text-blue-700 hover:underline">
          Back to your files
        </Link>
      </p>
    </div>
  );
}
