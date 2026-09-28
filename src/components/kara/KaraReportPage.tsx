import { useEffect, useState } from 'react';
import { renderNoteMarkdown } from '../mindmaps/markdown';

const API_URL = import.meta.env.VITE_API_URL || '';

interface PublicReport {
  id: string;
  title: string;
  goal: string;
  report: string;
  reportAt: string | null;
  public: boolean;
  author: { name: string; email: string };
}

// A Kara check-in report its author made public, reached via
// /kara-report?id=<check-in id>. Shows only the report, never the
// conversation; the server limits it to people in the author's organization.
export function KaraReportPage({ onExit }: { onExit: () => void }) {
  const id = new URLSearchParams(window.location.search).get('id') || '';
  const [report, setReport] = useState<PublicReport | null>(null);
  const [error, setError] = useState<string | null>(id ? null : 'No report was specified.');

  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/api/kara/reports/${encodeURIComponent(id)}`, { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Could not load the report');
        setReport(data as PublicReport);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not load the report');
      }
    })();
  }, [id]);

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-4">
        <button
          onClick={onExit}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          Back to OKR Lite
        </button>
        <p className="text-sm text-gray-500">Kara check-in report</p>
      </div>
      <div className="max-w-3xl mx-auto px-4 py-8">
        {error ? (
          <p className="text-sm text-gray-600 bg-white border border-gray-200 rounded-lg p-6">{error}</p>
        ) : !report ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : (
          <article className="bg-white border border-gray-200 rounded-lg p-6">
            <h1 className="text-xl font-semibold text-gray-900">{report.title}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {report.author.name}
              {report.reportAt && ` · ${new Date(report.reportAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })}`}
              {!report.public && ' · Private (only you can see this)'}
            </p>
            <div className="note-md text-sm text-gray-800 mt-5" dangerouslySetInnerHTML={{ __html: renderNoteMarkdown(report.report) }} />
          </article>
        )}
      </div>
    </div>
  );
}
