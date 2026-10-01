import Link from "next/link";

export default function NotFound() {
  return <div className="setup-page"><h1>Page not found</h1><Link href="/dashboard" className="button primary">Back to overview</Link></div>;
}