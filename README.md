# DocuLens / SpecVerify

An AI-assisted SOP and Technical Document Q&A Workspace that answers questions strictly from uploaded documents with page-level and chunk-level citations, reducing LLM hallucinations through structured schema enforcement.

---

## Key Features

- **Multi-Format Document Ingestion:** Supports `.pdf`, `.txt`, and `.md` files (up to 15 MB) with page-aware text extraction (`pypdf`).
- **Overlapping Sliding-Window Chunking:** Splits documents into 700-character chunks with a 120-character overlap so rules spanning boundaries stay intact.
- **Grounded Q&A with Verifiable Citations:** Uses Google Gemini (`gemini-3.8-flash`) with Pydantic structured JSON outputs (`AskResponse`) to return:
  - `answer`: Clear response grounded strictly in retrieved excerpts
  - `is_supported`: Boolean flag distinguishing supported answers from out-of-scope queries
  - `citations`: Exact `chunk_id`, `page` number, and verbatim supporting `quote`
- **Out-of-Scope Refusal Guard:** Automatically flags questions not covered in the document (`is_supported: false`) instead of fabricating answers.
- **Persistent Document Store & Per-Document History:** Saves parsed documents and chunks to local JSON storage (`backend/data/documents_store.json`) and maintains a per-document Q&A history feed in the UI.

---

## System Architecture

```text
[Upload PDF / TXT / MD]
        │
        ▼
[Page-Aware Text Extraction (pypdf / UTF-8)]
        │
        ▼
[Sliding-Window Chunker (700 chars, 120 overlap)] ──► [JSON Store (documents_store.json)]
        │
        ▼
[Token-Overlap Retriever (Top-K Relevant Chunks)]
        │
        ▼
[Gemini API (gemini-3.8-flash) + Pydantic JSON Schema]
        │
        ▼
[Grounded Answer + Support Status + Page/Chunk Citations]