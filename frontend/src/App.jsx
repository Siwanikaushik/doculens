import { useEffect, useRef, useState } from "react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:8000";

const SAMPLE_QUESTIONS = [
  {
    tag: "SLA & Escalation",
    text: "What is the SEV-1 target response time and when do we escalate to the Engineering Manager?",
  },
  {
    tag: "Release Rules",
    text: "What are the release rollback conditions or rollout criteria?",
  },
  {
    tag: "Out-of-Scope Test",
    text: "What is the company's parental leave and travel reimbursement policy?",
  },
];

function formatBytes(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export default function App() {
  const [documents, setDocuments] = useState([]);
  const [selectedDocId, setSelectedDocId] = useState("");
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState("");

  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [historyByDoc, setHistoryByDoc] = useState({});
  const [copiedId, setCopiedId] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  const fileInputRef = useRef(null);

  async function fetchDocuments(preferredId = "") {
    try {
      const res = await fetch(`${API_BASE}/api/documents`);
      if (!res.ok) return;
      const data = await res.json();
      setDocuments(data);

      if (preferredId) {
        setSelectedDocId(preferredId);
      } else if (data.length > 0 && !data.some((d) => d.doc_id === selectedDocId)) {
        setSelectedDocId(data[0].doc_id);
      } else if (data.length === 0) {
        setSelectedDocId("");
      }
    } catch {
      // Connection feedback appears during upload/ask actions
    }
  }

  useEffect(() => {
    fetchDocuments();
  }, []);

  function handleFileChosen(file) {
    if (!file) return;
    setErrorMsg("");
    setUploadNotice("");
    setSelectedFile(file);
  }

  async function handleUpload(e) {
    e.preventDefault();
    setErrorMsg("");
    setUploadNotice("");

    if (!selectedFile) {
      setErrorMsg("Please choose or drop a .pdf, .txt, or .md file first.");
      return;
    }

    const formData = new FormData();
    formData.append("file", selectedFile);

    setUploading(true);
    try {
      const res = await fetch(`${API_BASE}/api/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.detail || "Failed to upload document.");
        return;
      }

      setUploadNotice(
        `Indexed "${data.filename}" — ${data.page_count} page(s), ${data.chunk_count} chunks.`
      );
      setSelectedFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await fetchDocuments(data.doc_id);
    } catch {
      setErrorMsg(
        "Could not reach FastAPI backend at http://localhost:8000. Make sure uvicorn is running."
      );
    } finally {
      setUploading(false);
    }
  }

  async function handleDeleteDoc(e, docId) {
    e.stopPropagation();
    setErrorMsg("");
    try {
      const res = await fetch(`${API_BASE}/api/documents/${docId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setErrorMsg("Could not delete document.");
        return;
      }
      setHistoryByDoc((prev) => {
        const copy = { ...prev };
        delete copy[docId];
        return copy;
      });
      await fetchDocuments();
    } catch {
      setErrorMsg("Could not reach FastAPI backend.");
    }
  }

  async function handleAsk(e, overrideQuestion = null) {
    if (e) e.preventDefault();
    setErrorMsg("");

    if (!selectedDocId) {
      setErrorMsg("Please upload or select a document before asking a question.");
      return;
    }
    const trimmed = (overrideQuestion ?? question).trim();
    if (!trimmed) {
      setErrorMsg("Please enter a question.");
      return;
    }

    setAsking(true);
    try {
      const res = await fetch(`${API_BASE}/api/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_id: selectedDocId,
          question: trimmed,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        setErrorMsg(data.detail || "Failed to get an answer.");
        return;
      }

      const newEntry = {
        id: Date.now(),
        question: trimmed,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
        ...data,
      };

      setHistoryByDoc((prev) => ({
        ...prev,
        [selectedDocId]: [newEntry, ...(prev[selectedDocId] || [])],
      }));
      setQuestion("");
    } catch {
      setErrorMsg(
        "Could not reach FastAPI backend at http://localhost:8000. Make sure uvicorn is running."
      );
    } finally {
      setAsking(false);
    }
  }

  async function handleCopyAnswer(item) {
    try {
      await navigator.clipboard.writeText(item.answer);
      setCopiedId(item.id);
      setTimeout(() => setCopiedId(null), 1800);
    } catch {
      // Ignore clipboard errors in restricted contexts
    }
  }

  const activeDoc = documents.find((d) => d.doc_id === selectedDocId);
  const currentHistory = historyByDoc[selectedDocId] || [];
  const totalChunks = documents.reduce((acc, d) => acc + (d.chunk_count || 0), 0);
  const totalQuestions = Object.values(historyByDoc).reduce(
    (acc, list) => acc + list.length,
    0
  );

  return (
    <div className="relative min-h-screen overflow-x-hidden bg-slate-950 text-slate-100 selection:bg-sky-500/30 selection:text-sky-200">
      {/* Subtle ambient background glows */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-40 left-1/4 h-96 w-96 rounded-full bg-sky-500/10 blur-3xl" />
        <div className="absolute top-1/3 -right-24 h-96 w-96 rounded-full bg-indigo-500/10 blur-3xl" />
      </div>

      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-20 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500 to-indigo-600 shadow-lg shadow-sky-500/20">
              <svg
                className="h-5 w-5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">
                  DocuLens{" "}
                  <span className="bg-gradient-to-r from-sky-400 to-indigo-400 bg-clip-text text-transparent">
                    / SpecVerify
                  </span>
                </h1>
                <span className="rounded-md border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-sky-300">
                  Gemini Grounded
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Verifiable SOP &amp; Technical Document Q&amp;A with Page &amp; Chunk Citations
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-4 rounded-xl border border-slate-800 bg-slate-900/80 px-4 py-1.5 text-xs sm:flex">
              <div>
                <span className="text-slate-400">Docs: </span>
                <strong className="font-semibold text-white">{documents.length}</strong>
              </div>
              <span className="h-3.5 w-px bg-slate-800" />
              <div>
                <span className="text-slate-400">Chunks: </span>
                <strong className="font-semibold text-sky-300">{totalChunks}</strong>
              </div>
              <span className="h-3.5 w-px bg-slate-800" />
              <div>
                <span className="text-slate-400">Queries: </span>
                <strong className="font-semibold text-emerald-300">{totalQuestions}</strong>
              </div>
            </div>

            <span className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-300">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
              API Online
            </span>
          </div>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-7 px-6 py-8 lg:grid-cols-12">
        {/* Left Sidebar: Upload + Document Library */}
        <aside className="space-y-6 lg:col-span-4">
          {/* Drag & Drop Upload Card */}
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/75 p-5 shadow-xl backdrop-blur">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500/15 text-xs font-bold text-sky-400">
                1
              </span>
              <h2 className="text-sm font-semibold text-white">Ingest Document</h2>
            </div>

            <form onSubmit={handleUpload} className="mt-4 space-y-3">
              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setIsDragging(true);
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragging(false);
                  const dropped = e.dataTransfer.files?.[0];
                  if (dropped) handleFileChosen(dropped);
                }}
                className={`group flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
                  isDragging
                    ? "border-sky-400 bg-sky-500/10"
                    : selectedFile
                    ? "border-emerald-500/50 bg-emerald-500/5"
                    : "border-slate-700/80 bg-slate-950/60 hover:border-sky-500/60 hover:bg-slate-950"
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.txt,.md"
                  onChange={(e) => handleFileChosen(e.target.files?.[0] || null)}
                  className="hidden"
                />

                <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-full bg-slate-800/90 text-sky-400 transition group-hover:scale-105 group-hover:bg-sky-500/20">
                  <svg
                    className="h-5 w-5"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={2}
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                    />
                  </svg>
                </div>

                {selectedFile ? (
                  <div className="space-y-0.5">
                    <p className="max-w-[230px] truncate text-xs font-semibold text-emerald-300">
                      {selectedFile.name}
                    </p>
                    <p className="text-[11px] text-slate-400">
                      {formatBytes(selectedFile.size)} • Ready to index
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-200">
                      Drop file here or <span className="text-sky-400 underline">browse</span>
                    </p>
                    <p className="text-[11px] text-slate-500">
                      PDF, TXT, or Markdown • Max 15 MB
                    </p>
                  </div>
                )}
              </div>

              <button
                type="submit"
                disabled={uploading || !selectedFile}
                className="flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-sky-500 to-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:from-sky-400 hover:to-indigo-500 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
              >
                {uploading ? (
                  <>
                    <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Extracting &amp; Chunking...
                  </>
                ) : (
                  "Upload & Index Document"
                )}
              </button>
            </form>

            {uploadNotice && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2.5 text-xs text-emerald-300">
                <span className="mt-0.5">✓</span>
                <span>{uploadNotice}</span>
              </div>
            )}
          </div>

          {/* Knowledge Base / Document Library Card */}
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/75 p-5 shadow-xl backdrop-blur">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-500/15 text-xs font-bold text-sky-400">
                  2
                </span>
                <h2 className="text-sm font-semibold text-white">Document Library</h2>
              </div>
              <span className="rounded-full bg-slate-800 px-2.5 py-0.5 text-[11px] font-medium text-slate-300">
                {documents.length} stored
              </span>
            </div>

            {documents.length === 0 ? (
              <div className="mt-4 rounded-xl border border-slate-800 bg-slate-950/60 p-4 text-center">
                <p className="text-xs text-slate-400">
                  No indexed files yet. Upload a sample SOP from{" "}
                  <code className="rounded bg-slate-800 px-1.5 py-0.5 text-slate-200">
                    sample_docs/
                  </code>{" "}
                  or any PDF to start verifying.
                </p>
              </div>
            ) : (
              <div className="mt-4 space-y-2.5">
                {documents.map((doc) => {
                  const isSelected = doc.doc_id === selectedDocId;
                  const qCount = (historyByDoc[doc.doc_id] || []).length;
                  const isPdf = doc.filename.toLowerCase().endsWith(".pdf");

                  return (
                    <div
                      key={doc.doc_id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedDocId(doc.doc_id)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") setSelectedDocId(doc.doc_id);
                      }}
                      className={`group relative w-full cursor-pointer rounded-xl border p-3.5 text-left transition ${
                        isSelected
                          ? "border-sky-500/80 bg-gradient-to-r from-sky-500/15 to-indigo-500/10 shadow-md shadow-sky-500/10"
                          : "border-slate-800 bg-slate-950/60 hover:border-slate-700 hover:bg-slate-950"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={`shrink-0 rounded-lg px-2 py-1 text-[10px] font-bold uppercase ${
                              isPdf
                                ? "bg-rose-500/15 text-rose-300 border border-rose-500/30"
                                : "bg-sky-500/15 text-sky-300 border border-sky-500/30"
                            }`}
                          >
                            {isPdf ? "PDF" : "DOC"}
                          </span>
                          <span className="truncate text-sm font-medium text-white">
                            {doc.filename}
                          </span>
                        </div>

                        <button
                          type="button"
                          title="Delete document"
                          onClick={(e) => handleDeleteDoc(e, doc.doc_id)}
                          className="shrink-0 cursor-pointer rounded-lg p-1 text-slate-500 transition hover:bg-rose-500/20 hover:text-rose-300"
                        >
                          <svg
                            className="h-4 w-4"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>

                      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[11px] text-slate-400">
                        <span>{doc.page_count} page(s)</span>
                        <span>•</span>
                        <span>{doc.chunk_count} chunks</span>
                        <span>•</span>
                        <span className="font-mono text-slate-500">#{doc.doc_id}</span>
                        {qCount > 0 && (
                          <span className="ml-auto rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
                            {qCount} Q&amp;A
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </aside>

        {/* Right Main Column: Query Console + Grounded Results Feed */}
        <section className="space-y-6 lg:col-span-8">
          {/* Query Input Card */}
          <div className="rounded-2xl border border-slate-800/90 bg-slate-900/75 p-6 shadow-xl backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-xs font-bold text-emerald-400">
                  3
                </span>
                <h2 className="text-sm font-semibold text-white">Grounded Verification Console</h2>
              </div>

              {activeDoc ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-3 py-1 text-xs text-sky-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />
                  Querying: <strong className="font-semibold">{activeDoc.filename}</strong>
                </span>
              ) : (
                <span className="text-xs text-amber-300">Select or upload a document first</span>
              )}
            </div>

            <form onSubmit={handleAsk} className="mt-4 space-y-4">
              <div className="relative">
                <textarea
                  rows={3}
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleAsk(e);
                    }
                  }}
                  placeholder="Ask about SLA timelines, escalation owners, release gates, or policy clauses... (Press Enter to run)"
                  className="w-full rounded-xl border border-slate-700/90 bg-slate-950/90 p-3.5 text-sm text-white placeholder-slate-500 transition focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-2">
                  {SAMPLE_QUESTIONS.map((sample) => (
                    <button
                      key={sample.tag}
                      type="button"
                      onClick={() => setQuestion(sample.text)}
                      className="cursor-pointer rounded-lg border border-slate-700/80 bg-slate-800/60 px-2.5 py-1.5 text-xs text-slate-300 transition hover:border-sky-500/60 hover:bg-slate-800 hover:text-white"
                    >
                      + {sample.tag}
                    </button>
                  ))}
                </div>

                <button
                  type="submit"
                  disabled={asking || !selectedDocId}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:from-emerald-400 hover:to-teal-500 disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none"
                >
                  {asking ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      Verifying Excerpts...
                    </>
                  ) : (
                    <>
                      <span>Ask with Citations</span>
                      <span>→</span>
                    </>
                  )}
                </button>
              </div>
            </form>

            {errorMsg && (
              <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-xs text-rose-300">
                {errorMsg}
              </div>
            )}
          </div>

          {/* Empty State vs. Q&A History Feed */}
          {currentHistory.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-800 bg-slate-900/40 p-8 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-800/80 text-sky-400">
                <svg
                  className="h-6 w-6"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={1.8}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
                  />
                </svg>
              </div>
              <h3 className="text-sm font-semibold text-white">
                Zero-Hallucination Citation Engine Ready
              </h3>
              <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-slate-400">
                Every answer is verified against retrieved document chunks and tagged with exact
                page numbers and verbatim quotes—or cleanly refused if unsupported.
              </p>

              {activeDoc && (
                <div className="mt-5 grid grid-cols-1 gap-2.5 text-left sm:grid-cols-3">
                  {SAMPLE_QUESTIONS.map((sample) => (
                    <button
                      key={sample.tag}
                      type="button"
                      disabled={asking}
                      onClick={() => handleAsk(null, sample.text)}
                      className="cursor-pointer rounded-xl border border-slate-800 bg-slate-950/80 p-3 transition hover:border-sky-500/50 hover:bg-slate-900"
                    >
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-sky-400">
                        {sample.tag}
                      </span>
                      <p className="mt-1 line-clamp-2 text-xs text-slate-300">{sample.text}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Verified Audit Trail ({currentHistory.length})
                </h2>
                <button
                  type="button"
                  onClick={() =>
                    setHistoryByDoc((prev) => ({ ...prev, [selectedDocId]: [] }))
                  }
                  className="cursor-pointer text-xs text-slate-400 transition hover:text-rose-300"
                >
                  Clear audit trail
                </button>
              </div>

              {currentHistory.map((item) => (
                <article
                  key={item.id}
                  className="rounded-2xl border border-slate-800/90 bg-slate-900/85 p-6 shadow-xl backdrop-blur"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <span className="text-[11px] text-slate-500">{item.timestamp}</span>
                      <h3 className="text-base font-semibold text-white">{item.question}</h3>
                    </div>

                    <div className="flex items-center gap-2">
                      {item.is_supported ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                          Grounded in Document
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-medium text-amber-300">
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
                          Not Supported in Excerpts
                        </span>
                      )}

                      <button
                        type="button"
                        onClick={() => handleCopyAnswer(item)}
                        className="cursor-pointer rounded-lg border border-slate-700/80 bg-slate-800/80 px-2.5 py-1 text-xs text-slate-300 transition hover:border-slate-600 hover:text-white"
                      >
                        {copiedId === item.id ? "Copied ✓" : "Copy"}
                      </button>
                    </div>
                  </div>

                  <p className="mt-4 whitespace-pre-line text-sm leading-relaxed text-slate-200">
                    {item.answer}
                  </p>

                  <div className="mt-5 border-t border-slate-800/90 pt-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                        Supporting Evidence ({item.citations.length})
                      </h4>
                    </div>

                    {item.citations.length === 0 ? (
                      <p className="mt-2 text-xs text-slate-500">
                        No supporting document passages matched this query.
                      </p>
                    ) : (
                      <div className="mt-3 grid grid-cols-1 gap-3">
                        {item.citations.map((cite, idx) => (
                          <div
                            key={`${cite.chunk_id}-${idx}`}
                            className="rounded-xl border border-slate-800 bg-slate-950/90 p-3.5 transition hover:border-sky-500/40"
                          >
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="rounded bg-sky-500/10 px-2 py-0.5 font-mono text-[11px] text-sky-300">
                                {cite.chunk_id}
                              </span>
                              <span className="rounded-full border border-slate-700 bg-slate-900 px-2.5 py-0.5 text-[11px] font-medium text-slate-300">
                                Page {cite.page}
                              </span>
                            </div>
                            <blockquote className="mt-2 border-l-2 border-sky-500/70 pl-3 text-xs italic leading-relaxed text-slate-300">
                              &ldquo;{cite.quote}&rdquo;
                            </blockquote>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}